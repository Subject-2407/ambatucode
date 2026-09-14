"use client";

import {
  Anchor,
  Award,
  BookOpenCheck,
  Compass,
  Crosshair,
  Dumbbell,
  Eye,
  Feather,
  Flame,
  Footprints,
  Gauge,
  GraduationCap,
  Hourglass,
  Languages,
  Layers,
  ListChecks,
  Palette,
  RotateCcw,
  Shield,
  Snowflake,
  Sparkles,
  Star,
  Sunrise,
  TrendingUp,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * An achievement's `iconKey` to a drawing.
 *
 * The catalogue in `packages/shared` names a key rather than importing an
 * icon, because the same catalogue is read by the seed and the rule engine,
 * neither of which can render anything. This is the one place the two meet.
 *
 * Named imports rather than a dynamic lookup: lucide is a barrel, and a
 * dynamic index would pull every icon in the library into this chunk.
 */
const ICONS: Readonly<Record<string, LucideIcon>> = {
  anchor: Anchor,
  "book-open-check": BookOpenCheck,
  compass: Compass,
  crosshair: Crosshair,
  dumbbell: Dumbbell,
  eye: Eye,
  feather: Feather,
  flame: Flame,
  footprints: Footprints,
  gauge: Gauge,
  "graduation-cap": GraduationCap,
  hourglass: Hourglass,
  languages: Languages,
  layers: Layers,
  "list-checks": ListChecks,
  palette: Palette,
  "rotate-ccw": RotateCcw,
  shield: Shield,
  snowflake: Snowflake,
  sparkles: Sparkles,
  star: Star,
  sunrise: Sunrise,
  "trending-up": TrendingUp,
  users: Users,
  zap: Zap,
};

/** A key with no icon still renders something rather than a hole in the grid. */
export function AchievementIcon({ iconKey, size = 20 }: { iconKey: string; size?: number }) {
  const Icon = ICONS[iconKey] ?? Award;
  return <Icon size={size} aria-hidden />;
}
