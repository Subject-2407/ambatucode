"use client";

import { useState } from "react";
import { Alert, Checkbox, RadioGroup, Stack, Text } from "@chakra-ui/react";
import type {
  AssessmentArchitectView,
  ExecutionMode,
  SessionAccess,
  SessionView,
} from "@ambatucode/shared";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { SelectField } from "@/components/ui/select";
import { toaster } from "@/components/ui/toaster";
import { validationWarning } from "@/components/test-scripts/validation";
import { useCreateSession, useUpdateSession } from "@/hooks/use-sessions";
import { isApiError } from "@/lib/api-client";
import {
  buildCreateRequest,
  buildUpdateRequest,
  formFromSession,
  type SessionForm,
} from "@/lib/session-form";

/**
 * One form for making a session and for changing it before it starts.
 *
 * There was only ever a create dialog. Once a session existed its name, its
 * timing, its closing time and whether it waited for the room were fixed —
 * the PATCH endpoint existed, but nothing on screen called it — so a typo in a
 * closing time meant deleting the session and building it again.
 */
export type SessionSettingsDialogProps =
  | {
      mode: "create";
      assessment: AssessmentArchitectView;
      onClose: () => void;
      onCreated: (session: SessionView) => void;
    }
  | { mode: "edit"; session: SessionView; onClose: () => void };

export function SessionSettingsDialog(props: SessionSettingsDialogProps) {
  return props.mode === "create" ? <CreateDialog {...props} /> : <EditDialog {...props} />;
}

function CreateDialog({
  assessment,
  onClose,
  onCreated,
}: Extract<SessionSettingsDialogProps, { mode: "create" }>) {
  const create = useCreateSession(assessment.id);
  const timed = assessment.timeMode === "TIMED";
  const [form, setForm] = useState<SessionForm>({
    name: "",
    // The common case is a whole class. Choosing Coders one by one is the
    // exception, and it is a choice made on the next screen.
    access: "MODULE",
    executionMode: assessment.executionMode ?? "INDIVIDUAL",
    durationMinutes: String(assessment.durationMinutes ?? 30),
    closesAt: "",
    requireAllReady: false,
    openLobby: true,
  });
  const [error, setError] = useState<string | null>(null);
  // Advisory only: a session may still be created with unchecked scripts.
  const scriptWarning = validationWarning(assessment.testScripts);

  async function save() {
    setError(null);
    const built = buildCreateRequest(form, { timed, nowMs: Date.now() });
    if (!built.ok) {
      setError(built.error);
      return;
    }
    try {
      const session = await create.mutateAsync(built.request);
      toaster.success({ title: "Session created" });
      onCreated(session);
    } catch (saveError) {
      setError(isApiError(saveError) ? saveError.userMessage : "Could not create the session.");
    }
  }

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      size="sm"
      title="New session"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={create.isPending}>
            Create
          </Button>
        </>
      }
    >
      <Stack gap="4">
        {scriptWarning === null ? null : (
          <Alert.Root status="warning" size="sm">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description>
                {scriptWarning} Check them in the Test Scripts tab before Coders take this session.
              </Alert.Description>
            </Alert.Content>
          </Alert.Root>
        )}
        <TextField
          label="Name"
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.currentTarget.value })}
          placeholder="Class A, Tuesday lab"
          autoFocus
        />

        <AccessChoice value={form.access} onChange={(access) => setForm({ ...form, access })} />

        <SettingsFields form={form} setForm={setForm} timed={timed} />

        <Checkbox.Root
          checked={form.openLobby}
          onCheckedChange={(details) => setForm({ ...form, openLobby: details.checked === true })}
        >
          <Checkbox.HiddenInput />
          <Checkbox.Control />
          <Checkbox.Label>Open the lobby now</Checkbox.Label>
        </Checkbox.Root>
        <Text fontSize="xs" color="fg.muted" mt="-2">
          {form.openLobby
            ? "Coders see the session on the assessment page straight away and can say they are ready."
            : "Saved as a draft only you can see. Open the lobby from the session when you are ready."}
        </Text>

        {error === null ? null : (
          <Text fontSize="sm" color="fg.error" aria-live="polite">
            {error}
          </Text>
        )}
      </Stack>
    </Modal>
  );
}

function EditDialog({ session, onClose }: Extract<SessionSettingsDialogProps, { mode: "edit" }>) {
  const update = useUpdateSession(session.id);
  const [form, setForm] = useState<SessionForm>(() => formFromSession(session));
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    const built = buildUpdateRequest(form, session, { nowMs: Date.now() });
    if (!built.ok) {
      setError(built.error);
      return;
    }
    if (built.request === null) {
      onClose();
      return;
    }
    try {
      await update.mutateAsync(built.request);
      toaster.success({ title: "Session updated" });
      onClose();
    } catch (saveError) {
      setError(isApiError(saveError) ? saveError.userMessage : "Could not save the session.");
    }
  }

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      size="sm"
      title="Session settings"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={update.isPending}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={update.isPending}>
            Save
          </Button>
        </>
      }
    >
      <Stack gap="4">
        <TextField
          label="Name"
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.currentTarget.value })}
          autoFocus
        />
        <SettingsFields form={form} setForm={setForm} timed={session.executionMode !== null} />
        {error === null ? null : (
          <Text fontSize="sm" color="fg.error" aria-live="polite">
            {error}
          </Text>
        )}
      </Stack>
    </Modal>
  );
}

/**
 * Who takes part, as the two answers an Architect actually has.
 *
 * It used to be a select between "only the participants I list" and "anyone
 * enrolled", where the first, with nobody listed yet, quietly meant the
 * second. Neither label said that, and "wait until everyone is ready" then had
 * nobody to wait for.
 */
export function AccessChoice({
  value,
  onChange,
  disabled = false,
}: {
  value: SessionAccess;
  onChange: (access: SessionAccess) => void;
  disabled?: boolean;
}) {
  return (
    <Stack gap="2">
      <Text textStyle="display" fontSize="2xs" color="fg.muted">
        Who takes part
      </Text>
      <RadioGroup.Root
        value={value}
        onValueChange={(details) => {
          if (details.value === "MODULE" || details.value === "LISTED") onChange(details.value);
        }}
        disabled={disabled}
        colorPalette="accent"
      >
        <Stack gap="2">
          <RadioGroup.Item value="MODULE">
            <RadioGroup.ItemHiddenInput />
            <RadioGroup.ItemIndicator />
            <RadioGroup.ItemText>Everyone enrolled in the module</RadioGroup.ItemText>
          </RadioGroup.Item>
          <RadioGroup.Item value="LISTED">
            <RadioGroup.ItemHiddenInput />
            <RadioGroup.ItemIndicator />
            <RadioGroup.ItemText>Only the Coders I choose</RadioGroup.ItemText>
          </RadioGroup.Item>
        </Stack>
      </RadioGroup.Root>
      <Text fontSize="xs" color="fg.muted">
        {value === "MODULE"
          ? "Every approved Coder is expected, including anyone approved after you create this."
          : "You pick them on the session's page. Until you do, nobody can take part."}
      </Text>
    </Stack>
  );
}

function SettingsFields({
  form,
  setForm,
  timed,
}: {
  form: SessionForm;
  setForm: (form: SessionForm) => void;
  timed: boolean;
}) {
  // Live sets both of these by itself: its shared clock is the closing time,
  // and starting it before everyone is there costs those Coders their minutes.
  const isLive = timed && form.executionMode === "LIVE";

  return (
    <>
      {timed ? (
        <>
          <SelectField
            label="Execution mode"
            value={form.executionMode}
            onChange={(value) => setForm({ ...form, executionMode: value as ExecutionMode })}
            options={[
              { value: "INDIVIDUAL", label: "Individual — each Coder's own timer" },
              { value: "LIVE", label: "Live — one shared timer for everyone" },
            ]}
          />
          <TextField
            label="Duration (minutes)"
            type="number"
            min={1}
            max={600}
            value={form.durationMinutes}
            onChange={(event) => setForm({ ...form, durationMinutes: event.currentTarget.value })}
            helperText="Between 1 and 600 minutes."
          />
        </>
      ) : (
        <Text fontSize="sm" color="fg.muted">
          This assessment is untimed, so the session has no timer.
        </Text>
      )}

      {isLive ? (
        <Text fontSize="sm" color="fg.muted">
          A live session closes when its shared timer runs out, and Start waits for everyone to be
          ready. You can still start early.
        </Text>
      ) : (
        <>
          <TextField
            label="Closes at (optional)"
            type="datetime-local"
            value={form.closesAt}
            onChange={(event) => setForm({ ...form, closesAt: event.currentTarget.value })}
            helperText="After this moment nobody may join or submit, and anyone still working is submitted automatically. Leave it empty to close the session by hand."
          />

          <Checkbox.Root
            checked={form.requireAllReady}
            onCheckedChange={(details) =>
              setForm({ ...form, requireAllReady: details.checked === true })
            }
          >
            <Checkbox.HiddenInput />
            <Checkbox.Control />
            <Checkbox.Label>Wait until everyone is ready before starting</Checkbox.Label>
          </Checkbox.Root>
          <Text fontSize="xs" color="fg.muted" mt="-2">
            Coders press &ldquo;I&apos;m ready&rdquo; in the lobby. Start warns you about anyone who
            has not, and you can still start anyway.
          </Text>
        </>
      )}
    </>
  );
}
