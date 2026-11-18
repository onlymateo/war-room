CREATE TABLE `limit_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`window` text NOT NULL,
	`utilization` real,
	`resets_at` integer,
	`status` text,
	`observed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `limit_snapshots_idx` ON `limit_snapshots` (`provider_id`,`window`,`observed_at`);--> statement-breakpoint
CREATE TABLE `paused_work` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`war_room_id` text,
	`conversation_id` text NOT NULL,
	`agent_id` text,
	`title` text NOT NULL,
	`payload` text NOT NULL,
	`reason` text NOT NULL,
	`resets_at` integer,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
