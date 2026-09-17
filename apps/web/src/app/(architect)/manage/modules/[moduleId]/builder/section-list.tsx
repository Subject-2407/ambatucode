"use client";

import { useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Box, Flex, HStack, Stack, Text } from "@chakra-ui/react";
import { GripVertical, Pencil, Plus, Trash } from "lucide-react";
import type { ModuleSectionView } from "@ambatucode/shared";
import { Button, IconButton } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PromptDialog } from "@/components/ui/prompt-dialog";
import { toaster } from "@/components/ui/toaster";
import { useDeleteSection, useReorderSections, useUpdateSection } from "@/hooks/use-sections";
import { isApiError } from "@/lib/api-client";

/**
 * The section tree, reordered by dragging.
 *
 * The order on screen is local state so a drag lands instantly, and the server
 * call confirms it afterwards. A rejected reorder snaps back to the order that
 * was there before and says so — leaving the optimistic order in place would
 * show the Architect a module that does not exist.
 */
export function SectionList({
  moduleId,
  sections,
  selectedId,
  onSelect,
  onAdd,
  isStale = false,
}: {
  moduleId: string;
  sections: ModuleSectionView[];
  selectedId: string | null;
  onSelect: (sectionId: string) => void;
  onAdd: () => void;
  /** True while the tree is being refetched, which makes it unsafe to drag. */
  isStale?: boolean;
}) {
  const [order, setOrder] = useState(sections);
  const [lastFromServer, setLastFromServer] = useState(sections);
  const [renaming, setRenaming] = useState<ModuleSectionView | null>(null);
  const [deleting, setDeleting] = useState<ModuleSectionView | null>(null);
  const reorder = useReorderSections(moduleId);
  const updateSection = useUpdateSection(moduleId);
  const deleteSection = useDeleteSection(moduleId);

  /**
   * The server remains the source of truth, so a refetch replaces the local
   * order. Adjusted during render rather than in an effect: an effect would
   * paint the stale order once before correcting it, which on a rejected
   * reorder is exactly the frame the Architect must not see.
   */
  if (lastFromServer !== sections) {
    setLastFromServer(sections);
    setOrder(sections);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const from = order.findIndex((section) => section.id === active.id);
    const to = order.findIndex((section) => section.id === over.id);
    if (from === -1 || to === -1) return;

    const previous = order;
    const next = arrayMove(order, from, to);
    setOrder(next);

    try {
      await reorder.mutateAsync(next.map((section) => section.id));
    } catch (error) {
      setOrder(previous);
      toaster.error({
        title: "Could not save the new order",
        description: isApiError(error) ? error.userMessage : undefined,
      });
    }
  }

  async function rename(section: ModuleSectionView, title: string) {
    setRenaming(null);
    if (title === section.title) return;

    try {
      await updateSection.mutateAsync({ sectionId: section.id, changes: { title } });
    } catch (error) {
      toaster.error({
        title: "Could not rename the section",
        description: isApiError(error) ? error.userMessage : undefined,
      });
    }
  }

  async function remove(section: ModuleSectionView) {
    setDeleting(null);
    try {
      await deleteSection.mutateAsync(section.id);
      toaster.success({ title: `Deleted ${section.title}` });
    } catch (error) {
      toaster.error({
        title: "Could not delete the section",
        description: isApiError(error) ? error.userMessage : undefined,
      });
    }
  }

  return (
    <Stack gap="3" height="full">
      <Flex justify="space-between" align="center">
        <Text fontWeight="semibold" fontSize="sm">
          Sections
        </Text>
        <Button size="xs" variant="ghost" onClick={onAdd}>
          <Plus aria-hidden />
          Add section
        </Button>
      </Flex>

      {order.length === 0 ? (
        <Text fontSize="sm" color="fg.muted">
          No sections yet. Add one to start building.
        </Text>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={(event) => void onDragEnd(event)}
        >
          <SortableContext
            items={order.map((section) => section.id)}
            strategy={verticalListSortingStrategy}
          >
            <Stack gap="2">
              {order.map((section) => (
                <SortableSection
                  key={section.id}
                  section={section}
                  selected={section.id === selectedId}
                  dragDisabled={isStale}
                  onSelect={() => onSelect(section.id)}
                  onRename={() => setRenaming(section)}
                  onDelete={() => setDeleting(section)}
                />
              ))}
            </Stack>
          </SortableContext>
        </DndContext>
      )}

      {renaming ? (
        <PromptDialog
          title="Rename section"
          label="Title"
          initialValue={renaming.title}
          loading={updateSection.isPending}
          onConfirm={(title) => void rename(renaming, title)}
          onClose={() => setRenaming(null)}
        />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        title="Delete section"
        description={`"${deleting?.title ?? ""}" and every material inside it will be removed.`}
        confirmLabel="Delete"
        destructive
        loading={deleteSection.isPending}
        onConfirm={() => {
          if (deleting) void remove(deleting);
        }}
        onClose={() => setDeleting(null)}
      />
    </Stack>
  );
}

function SortableSection({
  section,
  selected,
  dragDisabled,
  onSelect,
  onRename,
  onDelete,
}: {
  section: ModuleSectionView;
  selected: boolean;
  dragDisabled: boolean;
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  /**
   * Dragging is refused while the tree is refetching.
   *
   * A reorder is sent as the complete list of ids, and the endpoint rejects one
   * that does not match the module exactly — correctly, since a partial list
   * would strand whatever it omits. Starting a drag against a list that is
   * about to be replaced produces precisely that request, and the Architect
   * sees their drag snap back for no visible reason.
   */
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: section.id,
    disabled: dragDisabled,
  });

  return (
    <Flex
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      align="center"
      gap="1"
      borderWidth="1px"
      borderColor={selected ? "accent.solid" : "border.default"}
      bg={selected ? "bg.subtle" : "bg.surface"}
      borderRadius="md"
      padding="2"
      opacity={isDragging ? 0.6 : 1}
    >
      {/* The handle carries the drag listeners, so clicking the row still
          selects it and a keyboard user can reorder without a pointer. */}
      <IconButton
        aria-label={`Reorder ${section.title}`}
        size="xs"
        cursor="grab"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={14} aria-hidden />
      </IconButton>

      <Box asChild flex="1" minWidth="0" textAlign="start">
        <button type="button" onClick={onSelect} aria-current={selected ? "true" : undefined}>
          <Text fontSize="sm" truncate>
            {section.title}
          </Text>
          <Text fontSize="xs" color="fg.muted">
            {section.materials.length} {section.materials.length === 1 ? "material" : "materials"}
          </Text>
        </button>
      </Box>

      <HStack gap="0">
        <IconButton aria-label={`Rename ${section.title}`} size="xs" onClick={onRename}>
          <Pencil size={14} aria-hidden />
        </IconButton>
        <IconButton aria-label={`Delete ${section.title}`} size="xs" onClick={onDelete}>
          <Trash size={14} aria-hidden />
        </IconButton>
      </HStack>
    </Flex>
  );
}
