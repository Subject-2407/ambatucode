"use client";

import { Box, Flex, HStack, Stack, Text } from "@chakra-ui/react";
import { FileText, Plus, Terminal, Trash } from "lucide-react";
import type { ModuleMaterialSummary } from "@ambatucode/shared";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PromptDialog } from "@/components/ui/prompt-dialog";
import { toaster } from "@/components/ui/toaster";
import { useCreateMaterial, useDeleteMaterial } from "@/hooks/use-materials";
import { isApiError } from "@/lib/api-client";

/**
 * The materials of the selected section.
 *
 * Ordering here follows creation order: the endpoint that would reorder a
 * material within its section does not exist yet, and inventing a client-side
 * order would be a lie the next page load corrects.
 */
export function MaterialList({
  moduleId,
  sectionId,
  materials,
  selectedId,
  onSelect,
}: {
  moduleId: string;
  sectionId: string | null;
  materials: ModuleMaterialSummary[];
  selectedId: string | null;
  onSelect: (materialId: string | null) => void;
}) {
  const createMaterial = useCreateMaterial(moduleId);
  const deleteMaterial = useDeleteMaterial(moduleId);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<ModuleMaterialSummary | null>(null);

  async function add(title: string) {
    setAdding(false);
    if (sectionId === null) return;

    try {
      const created = await createMaterial.mutateAsync({
        sectionId,
        input: { title, isPublished: false },
      });
      // A new material opens straight away: the Architect asked for it in order
      // to write in it.
      onSelect(created.id);
    } catch (error) {
      toaster.error({
        title: "Could not add the material",
        description: isApiError(error) ? error.userMessage : undefined,
      });
    }
  }

  async function remove(material: ModuleMaterialSummary) {
    setDeleting(null);
    try {
      await deleteMaterial.mutateAsync(material.id);
      if (selectedId === material.id) onSelect(null);
      toaster.success({ title: `Deleted ${material.title}` });
    } catch (error) {
      toaster.error({
        title: "Could not delete the material",
        description: isApiError(error) ? error.userMessage : undefined,
      });
    }
  }

  if (sectionId === null) {
    return (
      <Text fontSize="sm" color="fg.muted">
        Select a section to see its materials.
      </Text>
    );
  }

  return (
    <Stack gap="3" height="full">
      <Flex justify="space-between" align="center">
        <Text fontWeight="semibold" fontSize="sm">
          Materials
        </Text>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => setAdding(true)}
          loading={createMaterial.isPending}
        >
          <Plus aria-hidden />
          Add material
        </Button>
      </Flex>

      {materials.length === 0 ? (
        <Text fontSize="sm" color="fg.muted">
          This section has no materials yet.
        </Text>
      ) : (
        <Stack gap="2">
          {materials.map((material) => (
            <Flex
              key={material.id}
              align="center"
              gap="1"
              borderWidth="1px"
              borderColor={material.id === selectedId ? "accent.solid" : "border.default"}
              bg={material.id === selectedId ? "bg.subtle" : "bg.surface"}
              borderRadius="md"
              padding="2"
            >
              <Box asChild flex="1" minWidth="0" textAlign="start">
                <button
                  type="button"
                  onClick={() => onSelect(material.id)}
                  aria-current={material.id === selectedId ? "true" : undefined}
                >
                  <HStack gap="2" minWidth="0">
                    <FileText size={14} aria-hidden />
                    <Text fontSize="sm" truncate>
                      {material.title}
                    </Text>
                  </HStack>
                  <HStack gap="2" mt="1">
                    <Badge tone={material.isPublished ? "success" : "neutral"}>
                      {material.isPublished ? "Published" : "Draft"}
                    </Badge>
                    {material.practiceCount > 0 ? (
                      <Badge tone="accent">
                        <Terminal size={12} aria-hidden /> {material.practiceCount}
                      </Badge>
                    ) : null}
                  </HStack>
                </button>
              </Box>

              <IconButton
                aria-label={`Delete ${material.title}`}
                size="xs"
                onClick={() => setDeleting(material)}
              >
                <Trash size={14} aria-hidden />
              </IconButton>
            </Flex>
          ))}
        </Stack>
      )}

      {adding ? (
        <PromptDialog
          title="New material"
          label="Title"
          placeholder="Reading input"
          confirmLabel="Add material"
          loading={createMaterial.isPending}
          onConfirm={(title) => void add(title)}
          onClose={() => setAdding(false)}
        />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        title="Delete material"
        description={`"${deleting?.title ?? ""}" and its practice activities will be removed.`}
        confirmLabel="Delete"
        destructive
        loading={deleteMaterial.isPending}
        onConfirm={() => {
          if (deleting) void remove(deleting);
        }}
        onClose={() => setDeleting(null)}
      />
    </Stack>
  );
}
