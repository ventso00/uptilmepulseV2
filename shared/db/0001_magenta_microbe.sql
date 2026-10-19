CREATE TABLE `incidents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`monitorId` int NOT NULL,
	`startedAt` timestamp NOT NULL,
	`confirmedAt` timestamp,
	`resolvedAt` timestamp,
	`durationSeconds` int,
	`status` enum('suspect','confirmed','resolved') NOT NULL DEFAULT 'suspect',
	`reason` varchar(500),
	`lastFailureLogId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `incidents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `monitors` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(120) NOT NULL,
	`url` varchar(2048) NOT NULL,
	`intervalSeconds` int NOT NULL DEFAULT 300,
	`timeoutMs` int NOT NULL DEFAULT 10000,
	`enabled` boolean NOT NULL DEFAULT true,
	`currentStatus` enum('UNKNOWN','UP','DOWN','PAUSED') NOT NULL DEFAULT 'UNKNOWN',
	`consecutiveFailures` int NOT NULL DEFAULT 0,
	`consecutiveSuccesses` int NOT NULL DEFAULT 0,
	`nextCheckAt` timestamp NOT NULL DEFAULT (now()),
	`lastCheckAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `monitors_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notification_channels` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`type` enum('telegram') NOT NULL,
	`configurationEncrypted` text NOT NULL,
	`enabled` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `notification_channels_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notification_deliveries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`incidentId` int NOT NULL,
	`channelId` int NOT NULL,
	`type` enum('failure','recovery','test') NOT NULL,
	`status` enum('pending','sent','failed') NOT NULL DEFAULT 'pending',
	`attempts` int NOT NULL DEFAULT 0,
	`lastError` varchar(500),
	`sentAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `notification_deliveries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ping_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`monitorId` int NOT NULL,
	`statusCode` int,
	`responseTimeMs` int,
	`isUp` boolean NOT NULL,
	`classification` enum('UP_HTTP_2XX','UP_HTTP_3XX','DOWN_HTTP_4XX','DOWN_HTTP_5XX','DOWN_TIMEOUT','DOWN_DNS','DOWN_TLS','DOWN_NETWORK','INVALID_TARGET','BLOCKED_TARGET') NOT NULL,
	`errorMessage` varchar(500),
	`checkedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ping_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tokenHash` varchar(128) NOT NULL,
	`userId` int NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`revokedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `sessions_token_hash_unique` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
CREATE TABLE `user_credentials` (
	`userId` int NOT NULL,
	`emailNormalized` varchar(320) NOT NULL,
	`passwordHash` varchar(255) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_credentials_userId` PRIMARY KEY(`userId`),
	CONSTRAINT `user_credentials_email_unique` UNIQUE(`emailNormalized`)
);
--> statement-breakpoint
ALTER TABLE `incidents` ADD CONSTRAINT `incidents_monitorId_monitors_id_fk` FOREIGN KEY (`monitorId`) REFERENCES `monitors`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incidents` ADD CONSTRAINT `incidents_lastFailureLogId_ping_logs_id_fk` FOREIGN KEY (`lastFailureLogId`) REFERENCES `ping_logs`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `monitors` ADD CONSTRAINT `monitors_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notification_channels` ADD CONSTRAINT `notification_channels_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notification_deliveries` ADD CONSTRAINT `notification_deliveries_incidentId_incidents_id_fk` FOREIGN KEY (`incidentId`) REFERENCES `incidents`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notification_deliveries` ADD CONSTRAINT `notification_deliveries_channelId_notification_channels_id_fk` FOREIGN KEY (`channelId`) REFERENCES `notification_channels`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ping_logs` ADD CONSTRAINT `ping_logs_monitorId_monitors_id_fk` FOREIGN KEY (`monitorId`) REFERENCES `monitors`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_credentials` ADD CONSTRAINT `user_credentials_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `incidents_monitor_status_idx` ON `incidents` (`monitorId`,`status`);--> statement-breakpoint
CREATE INDEX `monitors_owner_due_idx` ON `monitors` (`userId`,`enabled`,`nextCheckAt`);--> statement-breakpoint
CREATE INDEX `monitors_enabled_next_check_idx` ON `monitors` (`enabled`,`nextCheckAt`);--> statement-breakpoint
CREATE INDEX `notification_channels_user_type_idx` ON `notification_channels` (`userId`,`type`);--> statement-breakpoint
CREATE INDEX `notification_deliveries_incident_channel_idx` ON `notification_deliveries` (`incidentId`,`channelId`);--> statement-breakpoint
CREATE INDEX `ping_logs_monitor_checked_idx` ON `ping_logs` (`monitorId`,`checkedAt`);--> statement-breakpoint
CREATE INDEX `sessions_user_expiry_idx` ON `sessions` (`userId`,`expiresAt`);