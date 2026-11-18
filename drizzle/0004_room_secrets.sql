CREATE TABLE `room_secrets` (
	`id` text PRIMARY KEY NOT NULL,
	`war_room_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`encrypted_value` text NOT NULL,
	`hint` text NOT NULL,
	`agent_ids` text DEFAULT '[]' NOT NULL,
	`server_ids` text DEFAULT '[]' NOT NULL,
	`require_approval` integer DEFAULT false NOT NULL,
	`last_used_at` integer,
	`use_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `room_secrets_idx` ON `room_secrets` (`war_room_id`,`name`);