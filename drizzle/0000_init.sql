CREATE TABLE `activity` (
	`id` text PRIMARY KEY NOT NULL,
	`war_room_id` text,
	`project_id` text,
	`agent_id` text,
	`type` text NOT NULL,
	`summary` text NOT NULL,
	`data` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `activity_created_idx` ON `activity` (`created_at`);--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`war_room_id` text,
	`role` text DEFAULT 'agent' NOT NULL,
	`name` text NOT NULL,
	`icon` text DEFAULT 'bot' NOT NULL,
	`color` text DEFAULT 'slate' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`function` text DEFAULT '' NOT NULL,
	`personality` text DEFAULT '' NOT NULL,
	`provider_id` text,
	`model_id` text,
	`system_prompt` text DEFAULT '' NOT NULL,
	`params` text DEFAULT '{}' NOT NULL,
	`skills` text DEFAULT '[]' NOT NULL,
	`mcp_servers` text DEFAULT '[]' NOT NULL,
	`memory` text DEFAULT '' NOT NULL,
	`token_limit` integer,
	`budget_usd` real,
	`priority` integer DEFAULT 0 NOT NULL,
	`permissions` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agents_war_room_idx` ON `agents` (`war_room_id`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`war_room_id` text,
	`agent_id` text,
	`title` text NOT NULL,
	`provider_id` text,
	`model_id` text,
	`params` text DEFAULT '{}' NOT NULL,
	`system_prompt` text DEFAULT '' NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`summary` text,
	`summary_up_to` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `conversations_war_room_idx` ON `conversations` (`war_room_id`);--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`sha256` text NOT NULL,
	`storage_path` text NOT NULL,
	`project_id` text,
	`war_room_id` text,
	`conversation_id` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`text_content` text,
	`extraction` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mcp_servers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`transport` text NOT NULL,
	`command` text,
	`args` text DEFAULT '[]' NOT NULL,
	`encrypted_env` text,
	`url` text,
	`encrypted_headers` text,
	`enabled` integer DEFAULT true NOT NULL,
	`sensitive_tools` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `memories` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`scope_id` text,
	`kind` text NOT NULL,
	`content` text NOT NULL,
	`source` text DEFAULT 'user' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`agent_id` text,
	`content` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`provider_id` text,
	`model_id` text,
	`attachment_ids` text DEFAULT '[]' NOT NULL,
	`meta` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `messages_conversation_idx` ON `messages` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `models` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`model_id` text NOT NULL,
	`display_name` text NOT NULL,
	`context_window` integer,
	`max_output_tokens` integer,
	`capabilities` text NOT NULL,
	`input_price` real,
	`output_price` real,
	`cache_read_price` real,
	`cache_write_price` real,
	`price_source` text,
	`tier` text,
	`source` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `models_provider_idx` ON `models` (`provider_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`objectives` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`budget_usd` real,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `provider_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`encrypted_secret` text,
	`secret_hint` text,
	`base_url` text,
	`config` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'unknown' NOT NULL,
	`last_error` text,
	`last_checked_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`war_room_id` text,
	`project_id` text,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'todo' NOT NULL,
	`priority` integer DEFAULT 2 NOT NULL,
	`assignee_agent_id` text,
	`depends_on` text DEFAULT '[]' NOT NULL,
	`result` text,
	`due_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `usage_events` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text,
	`message_id` text,
	`agent_id` text,
	`war_room_id` text,
	`project_id` text,
	`provider_id` text NOT NULL,
	`model_id` text NOT NULL,
	`purpose` text DEFAULT 'chat' NOT NULL,
	`input_tokens` integer,
	`output_tokens` integer,
	`cache_read_tokens` integer,
	`cache_write_tokens` integer,
	`context_tokens` integer,
	`cost_usd` real,
	`cost_kind` text NOT NULL,
	`latency_ms` integer,
	`status` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `usage_created_idx` ON `usage_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `usage_war_room_idx` ON `usage_events` (`war_room_id`);--> statement-breakpoint
CREATE TABLE `war_rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`objective` text DEFAULT '' NOT NULL,
	`brief` text DEFAULT '' NOT NULL,
	`autonomy` text DEFAULT 'semi' NOT NULL,
	`cost_strategy` text DEFAULT 'balanced' NOT NULL,
	`budget_usd` real,
	`max_agents_per_turn` integer DEFAULT 3 NOT NULL,
	`communication` text DEFAULT '' NOT NULL,
	`shared_memory` text DEFAULT '' NOT NULL,
	`analysis` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
