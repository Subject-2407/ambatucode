"use client";

import { Alert, Box, Heading, Stack, Text } from "@chakra-ui/react";
import type { PracticeActivityView, RichTextDocument } from "@ambatucode/shared";
import { PracticeActivity } from "@/components/content/practice-activity";
import { isEmptyDocument } from "@/components/content/rich-text";
import { RichTextView } from "@/components/content/rich-text-view";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * The Material as a Coder will read it, drawn from the editor's draft.
 *
 * It renders with the components the Coder's page uses — `RichTextView` for
 * the document, `PracticeActivity` for each activity — so this is delivery,
 * not an approximation of it. Interactive Blocks in the document go through
 * the same sandboxed frame they always do; the preview opens no path of its own
 * for authored content to reach this page.
 *
 * What it leaves out is the Coder's page furniture. The Module contents and the
 * Next link point at Coder routes, which only send an Architect back here, and
 * the reading layout remembers a Coder's sidebar preference in a cookie this
 * screen has no business writing.
 */
export function MaterialPreview({
  title,
  content,
  practiceActivities,
  kicker,
  hiddenReason,
  unsaved,
}: {
  title: string;
  content: RichTextDocument;
  /** The saved activities. They have their own dialogs and are never part of the draft. */
  practiceActivities: PracticeActivityView[];
  /** The Section label a Coder sees above the title. */
  kicker?: string;
  /** Why a Coder could not open this Material right now, or null when they could. */
  hiddenReason: string | null;
  unsaved: boolean;
}) {
  return (
    <Stack gap="6">
      {hiddenReason === null ? null : (
        <Alert.Root status="warning" size="sm">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Draft — not visible to Coders</Alert.Title>
            <Alert.Description>{hiddenReason}</Alert.Description>
          </Alert.Content>
        </Alert.Root>
      )}

      {unsaved ? (
        <Text fontSize="xs" color="fg.muted">
          Showing your unsaved changes. Coders see the last saved version until you save.
        </Text>
      ) : null}

      {/* The Coder's reading measure, so line lengths match what they get. */}
      <Box width="full" maxWidth="52rem" minWidth="0">
        <Stack gap="1" mb="6">
          {kicker ? (
            <Text textStyle="display" fontSize="2xs" color="accent.fg">
              {kicker}
            </Text>
          ) : null}
          {/* h2: the builder already has its page heading, the Module's title. */}
          <Heading as="h2" textStyle="display" fontSize={{ base: "xl", md: "2xl" }}>
            {title.trim() === "" ? "Untitled material" : title}
          </Heading>
        </Stack>

        <Stack gap="8">
          {isEmptyDocument(content) ? (
            <EmptyState
              sprite="doc"
              title="Nothing to read yet"
              description="A Coder opening this material sees only “This material has no content yet.” Switch to Edit to write it."
            />
          ) : (
            <RichTextView document={content} />
          )}

          {practiceActivities.length > 0 ? (
            <Stack gap="4">
              <Text textStyle="display" fontSize="sm" color="accent.fg">
                Practice
              </Text>
              {practiceActivities.map((activity) => (
                <PracticeActivity key={activity.id} activity={activity} />
              ))}
            </Stack>
          ) : null}
        </Stack>
      </Box>
    </Stack>
  );
}
