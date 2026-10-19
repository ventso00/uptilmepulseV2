CREATE TABLE `qa_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`kind` enum('self_test','daily_digest') NOT NULL,
	`periodKey` varchar(32) NOT NULL,
	`status` enum('ok','attention','failed') NOT NULL DEFAULT 'ok',
	`summary` varchar(500),
	`detail` text,
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`finishedAt` timestamp,
	CONSTRAINT `qa_runs_id` PRIMARY KEY(`id`),
	CONSTRAINT `qa_runs_kind_period_unique` UNIQUE(`kind`,`periodKey`)
);
--> statement-breakpoint
CREATE TABLE `qa_ticket_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ticketId` int NOT NULL,
	`author` enum('client','support','system') NOT NULL,
	`visibility` enum('public','internal') NOT NULL DEFAULT 'public',
	`body` text NOT NULL,
	`fromStatus` enum('new','triaged','in_progress','waiting_client','resolved','closed'),
	`toStatus` enum('new','triaged','in_progress','waiting_client','resolved','closed'),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `qa_ticket_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `qa_tickets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`source` enum('client','auto','internal') NOT NULL,
	`kind` enum('bug','behaviour','ux') NOT NULL DEFAULT 'bug',
	`severity` enum('P1','P2','P3','P4') NOT NULL DEFAULT 'P3',
	`status` enum('new','triaged','in_progress','waiting_client','resolved','closed') NOT NULL DEFAULT 'new',
	`title` varchar(160) NOT NULL,
	`clientMessage` text NOT NULL,
	`steps` text,
	`expected` text,
	`actual` text,
	`reporterName` varchar(120),
	`reporterEmail` varchar(320),
	`reporterToken` varchar(64),
	`pageUrl` varchar(2048),
	`monitorId` int,
	`evidence` text,
	`fingerprint` varchar(64),
	`resolvedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `qa_tickets_id` PRIMARY KEY(`id`),
	CONSTRAINT `qa_tickets_reporterToken_unique` UNIQUE(`reporterToken`),
	CONSTRAINT `qa_tickets_fingerprint_unique` UNIQUE(`fingerprint`)
);
--> statement-breakpoint
ALTER TABLE `qa_ticket_events` ADD CONSTRAINT `qa_ticket_events_ticketId_qa_tickets_id_fk` FOREIGN KEY (`ticketId`) REFERENCES `qa_tickets`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `qa_tickets` ADD CONSTRAINT `qa_tickets_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `qa_tickets` ADD CONSTRAINT `qa_tickets_monitorId_monitors_id_fk` FOREIGN KEY (`monitorId`) REFERENCES `monitors`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `qa_ticket_events_ticket_created_idx` ON `qa_ticket_events` (`ticketId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `qa_tickets_owner_status_idx` ON `qa_tickets` (`userId`,`status`);--> statement-breakpoint
CREATE INDEX `qa_tickets_open_idx` ON `qa_tickets` (`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `qa_tickets_source_idx` ON `qa_tickets` (`source`,`createdAt`);