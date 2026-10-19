CREATE TABLE `plans` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(40) NOT NULL,
	`name` varchar(60) NOT NULL,
	`maxMonitors` int NOT NULL DEFAULT 3,
	`minIntervalSeconds` int NOT NULL DEFAULT 300,
	`maxTimeoutMs` int NOT NULL DEFAULT 30000,
	`maxChannels` int NOT NULL DEFAULT 1,
	`allowKeyword` boolean NOT NULL DEFAULT false,
	`priceCents` int NOT NULL DEFAULT 0,
	`trialDays` int NOT NULL DEFAULT 0,
	`isPublic` boolean NOT NULL DEFAULT true,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `plans_id` PRIMARY KEY(`id`),
	CONSTRAINT `plans_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
ALTER TABLE `ping_logs` MODIFY COLUMN `classification` enum('UP_HTTP_2XX','UP_HTTP_3XX','DOWN_HTTP_4XX','DOWN_HTTP_5XX','DOWN_TIMEOUT','DOWN_DNS','DOWN_TLS','DOWN_NETWORK','INVALID_TARGET','BLOCKED_TARGET','DOWN_KEYWORD_MISSING','DOWN_KEYWORD_PRESENT') NOT NULL;--> statement-breakpoint
ALTER TABLE `monitors` ADD `keyword` varchar(160);--> statement-breakpoint
ALTER TABLE `monitors` ADD `keywordMode` enum('must_contain','must_not_contain') DEFAULT 'must_contain' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `planId` int;--> statement-breakpoint
ALTER TABLE `users` ADD `trialEndsAt` timestamp;--> statement-breakpoint
CREATE INDEX `plans_sort_order_idx` ON `plans` (`sortOrder`);--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_planId_plans_id_fk` FOREIGN KEY (`planId`) REFERENCES `plans`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- Seed tiers. Idempotent: the console owns these rows afterwards, so a replay
-- must never overwrite limits the product owner has retuned.
-- minIntervalSeconds stays at or above the 300 s schema floor on purpose: the
-- status-page percentile sample bound is derived from that floor.
INSERT IGNORE INTO `plans` (`slug`,`name`,`maxMonitors`,`minIntervalSeconds`,`maxTimeoutMs`,`maxChannels`,`allowKeyword`,`priceCents`,`trialDays`,`isPublic`,`sortOrder`) VALUES
	('free','Free',3,300,30000,1,0,0,0,1,1),
	('pro','Pro',25,300,30000,3,1,900,14,1,2),
	('business','Business',100,300,30000,8,1,2900,14,1,3);