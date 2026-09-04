import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const rooms = sqliteTable("rooms", {
  code: text("code").primaryKey(),
  hostTokenHash: text("host_token_hash").notNull(),
  guestTokenHash: text("guest_token_hash"),
  hostName: text("host_name").notNull(),
  guestName: text("guest_name"),
  sideChoice: text("side_choice", { enum: ["cho", "han", "random"] }).notNull().default("random"),
  hostSide: text("host_side", { enum: ["cho", "han"] }),
  augments: integer("augments", { mode: "boolean" }).notNull().default(true),
  hostReady: integer("host_ready", { mode: "boolean" }).notNull().default(false),
  guestReady: integer("guest_ready", { mode: "boolean" }).notNull().default(false),
  status: text("status", { enum: ["waiting", "playing", "finished"] }).notNull().default("waiting"),
  gameJson: text("game_json"),
  matchNumber: integer("match_number").notNull().default(0),
  actionStartedAt: integer("action_started_at"),
  revision: integer("revision").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, (table) => [index("idx_rooms_expires_at").on(table.expiresAt)]);
