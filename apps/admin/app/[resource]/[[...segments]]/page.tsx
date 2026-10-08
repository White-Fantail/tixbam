import { renderResource } from "../../_lib/resource";
export const dynamic = "force-dynamic";
export default async function ResourceRoute({params, searchParams}: {
  params: Promise<{resource: string; segments?: string[]}>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { resource, segments } = await params;
  const query = await searchParams;
  return renderResource(resource, segments || [], query);
}
