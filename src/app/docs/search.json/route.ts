import { loadDocs } from "@/lib/docs/build";

// The docs search index (headings and text of every page), built from the markdown at build
// time; the search dialog fetches it on first open.
export const dynamic = "force-static";

export async function GET() {
  const { search } = await loadDocs();
  return Response.json(search);
}
