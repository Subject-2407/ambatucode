import { prisma } from "@ambatucode/db";
import { AppError, gradeExportQuerySchema } from "@ambatucode/shared";
import { requireModuleOwner, requireUser } from "@/server/auth/guards";
import { parseQuery, route } from "@/server/http/respond";
import { gradeExportFilename, streamGradeExport } from "@/server/services/grades-export";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ moduleId: string }> };

/**
 * The one route that does not answer in the API envelope: the body is a file.
 *
 * Authorization is still resolved before the response is constructed, so a
 * caller who may not read these grades gets the ordinary envelope error rather
 * than a download that turns out to be empty. The service checks again on its
 * first pull, which is what actually guards the rows.
 */
export const GET = route<RouteContext>(async (request, context) => {
  const actor = await requireUser();
  const { moduleId } = await context.params;
  const query = parseQuery(request, gradeExportQuerySchema);

  await requireModuleOwner(actor, moduleId);
  const module = await prisma.module.findUnique({
    where: { id: moduleId },
    select: { slug: true },
  });
  if (!module) throw new AppError("NOT_FOUND", "Module not found");

  const filename = gradeExportFilename(module.slug);
  return new Response(streamGradeExport(actor, moduleId, query), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // A grade export is a point-in-time snapshot of live data.
      "Cache-Control": "no-store",
    },
  });
});
