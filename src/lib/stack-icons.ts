import "server-only";

import {
  siAngular,
  siAnsible,
  siAstro,
  siBun,
  siCaddy,
  siCoolify,
  siDeno,
  siDirectus,
  siDjango,
  siDocker,
  siDotnet,
  siDrizzle,
  siElectron,
  siEsbuild,
  siEslint,
  siExpo,
  siExpress,
  siFastapi,
  siFastify,
  siFlask,
  siFlutter,
  siGhost,
  siGin,
  siGo,
  siGrafana,
  siHono,
  siJest,
  siKeycloak,
  siKubernetes,
  siLaravel,
  siMariadb,
  siMinio,
  siMysql,
  siN8n,
  siNestjs,
  siNextdotjs,
  siNginx,
  siNodedotjs,
  siNuxt,
  siOpenjdk,
  siPhoenixframework,
  siPhp,
  siPostgresql,
  siPrisma,
  siPrometheus,
  siPython,
  siReact,
  siReactquery,
  siRedis,
  siRedux,
  siRemix,
  siRuby,
  siRubyonrails,
  siRust,
  siSentry,
  siSpringboot,
  siStorybook,
  siStrapi,
  siSupabase,
  siSvelte,
  siSymfony,
  siTailwindcss,
  siTerraform,
  siTraefikproxy,
  siTypeorm,
  siTypescript,
  siVite,
  siVitest,
  siVuedotjs,
  siWebpack,
  siZod,
  type SimpleIcon,
} from "simple-icons";

import { catalogIconSlugs } from "@/lib/stack-catalog";
import { logoColors, type LogoColors } from "@/lib/logo-color";

// The simple-icons the stack catalog uses, imported by name so only these are bundled, and
// only on the server: the picker receives each icon's path and colours as props.

const ICONS: readonly SimpleIcon[] = [
  siAngular,
  siAnsible,
  siAstro,
  siBun,
  siCaddy,
  siCoolify,
  siDeno,
  siDirectus,
  siDjango,
  siDocker,
  siDotnet,
  siDrizzle,
  siElectron,
  siEsbuild,
  siEslint,
  siExpo,
  siExpress,
  siFastapi,
  siFastify,
  siFlask,
  siFlutter,
  siGhost,
  siGin,
  siGo,
  siGrafana,
  siHono,
  siJest,
  siKeycloak,
  siKubernetes,
  siLaravel,
  siMariadb,
  siMinio,
  siMysql,
  siN8n,
  siNestjs,
  siNextdotjs,
  siNginx,
  siNodedotjs,
  siNuxt,
  siOpenjdk,
  siPhoenixframework,
  siPhp,
  siPostgresql,
  siPrisma,
  siPrometheus,
  siPython,
  siReact,
  siReactquery,
  siRedis,
  siRedux,
  siRemix,
  siRuby,
  siRubyonrails,
  siRust,
  siSentry,
  siSpringboot,
  siStorybook,
  siStrapi,
  siSupabase,
  siSvelte,
  siSymfony,
  siTailwindcss,
  siTerraform,
  siTraefikproxy,
  siTypeorm,
  siTypescript,
  siVite,
  siVitest,
  siVuedotjs,
  siWebpack,
  siZod,
];

const BY_SLUG = new Map(ICONS.map((icon) => [icon.slug, icon]));

export interface StackIcon extends LogoColors {
  /** SVG path on simple-icons' 24x24 grid. */
  path: string;
}

/** Every catalog icon by slug; a slug without an import is left out (a monogram tile). */
export function stackIcons(): Record<string, StackIcon> {
  const out: Record<string, StackIcon> = {};
  for (const slug of catalogIconSlugs()) {
    const icon = BY_SLUG.get(slug);
    if (icon) out[slug] = { path: icon.path, ...logoColors(icon.hex) };
  }
  return out;
}

/** Slugs the catalog names that are not imported here (the icon test keeps this empty). */
export function missingIconSlugs(): string[] {
  return catalogIconSlugs().filter((slug) => !BY_SLUG.has(slug));
}
