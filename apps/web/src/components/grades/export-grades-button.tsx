"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import type { GradeRecordQuery } from "@ambatucode/shared";
import { Button } from "@/components/ui/button";
import { toaster } from "@/components/ui/toaster";

/**
 * Downloads the module's grades as CSV.
 *
 * Fetched rather than linked, for two reasons. A plain link cannot surface a
 * refusal — a 403 would navigate the Architect to a JSON error page — and it
 * cannot show that the export is running, which for a large module is several
 * seconds of apparent nothing.
 *
 * The response streams from the server; this reads it to a blob before saving,
 * because a browser download cannot be resumed and a half-written grade file
 * is worse than a wait. The progress shown is honest about that: it reports
 * bytes received, not a percentage nobody can know in advance.
 */
export function ExportGradesButton({
  moduleId,
  query,
  disabled,
}: {
  moduleId: string;
  query: GradeRecordQuery;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [received, setReceived] = useState(0);

  async function download() {
    setBusy(true);
    setReceived(0);
    try {
      const params = new URLSearchParams({ format: "csv" });
      if (query.search) params.set("search", query.search);
      if (query.sectionId) params.set("sectionId", query.sectionId);
      if (query.assessmentId) params.set("assessmentId", query.assessmentId);
      if (query.sessionId) params.set("sessionId", query.sessionId);
      if (query.status) params.set("status", query.status);
      if (query.resetOnly === true) params.set("resetOnly", "true");

      const response = await fetch(`/api/modules/${moduleId}/grades/export?${params.toString()}`);
      if (!response.ok) {
        // The error envelope is JSON even though the success path is a file.
        throw new Error(String(response.status));
      }

      const chunks: BlobPart[] = [];
      const reader = response.body?.getReader();
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          // Copied into a plain ArrayBuffer view: the stream's chunk is backed
          // by a buffer the reader may reuse for the next read.
          chunks.push(new Uint8Array(value).slice().buffer);
          setReceived((total) => total + value.byteLength);
        }
      }

      const blob = new Blob(chunks.length > 0 ? chunks : [await response.blob()], {
        type: "text/csv;charset=utf-8",
      });
      const disposition = response.headers.get("content-disposition") ?? "";
      const named = /filename="([^"]+)"/.exec(disposition);

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = named?.[1] ?? "grades.csv";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);

      toaster.success({ title: "Grades exported" });
    } catch {
      toaster.error({
        title: "Could not export the grades",
        description: "Check that you still own this module, then try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant="outline"
      loading={busy}
      loadingText={received > 0 ? `Exporting ${Math.round(received / 1024)} KB` : "Exporting"}
      disabled={disabled}
      onClick={() => void download()}
    >
      <Download aria-hidden />
      Export CSV
    </Button>
  );
}
