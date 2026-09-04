CREATE TABLE `rooms` (
	`code` text PRIMARY KEY NOT NULL,
	`host_token_hash` text NOT NULL,
	`guest_token_hash` text,
	`host_name` text NOT NULL,
	`guest_name` text,
	`side_choice` text DEFAULT 'random' NOT NULL,
	`host_side` text,
	`augments` integer DEFAULT true NOT NULL,
	`host_ready` integer DEFAULT false NOT NULL,
	`guest_ready` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'waiting' NOT NULL,
	`game_json` text,
	`match_number` integer DEFAULT 0 NOT NULL,
	`action_started_at` integer,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_rooms_expires_at` ON `rooms` (`expires_at`);