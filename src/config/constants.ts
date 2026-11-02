// Global tuning constants. Distances are in world pixels (1 cell = 16 px, roughly 0.5 m).

export const CELL = 16;
export const SIM_DT = 1 / 60;

export const CHAR_RADIUS = 9;
export const CHAR_MAX_HP = 100;
export const BASE_MOVE_SPEED = 118;
export const SPRINT_MULT = 1.45;
export const CROUCH_MULT = 0.5;
export const QUIET_MULT = 0.55;
export const SPRINT_TO_FIRE_DELAY = 0.18;

export const VIEW_FOV = (110 * Math.PI) / 180;
export const VIEW_FOV_ADS = (90 * Math.PI) / 180;
export const VIEW_RANGE = 1100;
export const NEAR_AWARENESS_RADIUS = 42;

export const BOT_FOV = (120 * Math.PI) / 180;

/** Line of sight is lost once a ray has travelled this far through smoke. */
export const SMOKE_SIGHT_DEPTH = 18;

// Doorways & barricades
export const BARRICADE_SEGMENT_SIZE = 8; // px of doorway width per localized section
export const BARRICADE_THICKNESS = 6;
export const BARRICADE_SEGMENT_HP = 60;
export const BARRICADE_BUILD_TIME = 2.6;
export const BARRICADE_REMOVE_TIME = 1.2;
export const BARRICADE_BULLET_FACTOR = 0.5; // wood takes 50% of bullet damage (x weapon material multiplier)
export const INTERACT_REACH = 34;

// Walls
export const SOFT_WALL_HP = 100;
export const WALL_BULLET_FACTOR = 0.25;
export const REINFORCE_TIME = 3.5;
export const REINFORCEMENTS_PER_TEAM = 8;
export const PANEL_MAX_CELLS = 4;

// Melee
export const MELEE_REACH = 30;
export const MELEE_ARC = (120 * Math.PI) / 180;
export const MELEE_DAMAGE = 40;
export const MELEE_MATERIAL_DAMAGE = 40;
export const MELEE_COOLDOWN = 0.6;

// Drones / cameras
export const DRONES_PER_ATTACKER = 2;
export const DRONE_RADIUS = 5;
export const DRONE_SPEED = 170;
export const DRONE_FOV = (120 * Math.PI) / 180;
export const DRONE_RANGE = 460;
export const CAMERA_FOV = (100 * Math.PI) / 180;
export const CAMERA_RANGE = 720;
export const CAMERA_YAW_LIMIT = (60 * Math.PI) / 180;

// Team intel (call-outs)
export const INTEL_TTL = 3.0;
export const MARK_TTL = 4.5;

export type ArmorTier = 'light' | 'medium' | 'heavy';
export const ARMOR: Record<ArmorTier, { reduction: number; speed: number; label: string }> = {
  light: { reduction: 0.0, speed: 1.06, label: 'Light' },
  medium: { reduction: 0.1, speed: 1.0, label: 'Medium' },
  heavy: { reduction: 0.2, speed: 0.92, label: 'Heavy' },
};
