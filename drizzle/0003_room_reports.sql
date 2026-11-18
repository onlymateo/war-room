CREATE TABLE `room_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`war_room_id` text NOT NULL,
	`kind` text NOT NULL,
	`day` text NOT NULL,
	`period_start` integer NOT NULL,
	`period_end` integer NOT NULL,
	`markdown` text NOT NULL,
	`stats` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `room_reports_idx` ON `room_reports` (`war_room_id`,`day`);