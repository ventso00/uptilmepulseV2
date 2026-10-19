CREATE TABLE `status_pages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`slug` varchar(64) NOT NULL,
	`title` varchar(120) NOT NULL,
	`description` varchar(500),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `status_pages_id` PRIMARY KEY(`id`),
	CONSTRAINT `status_pages_userId_unique` UNIQUE(`userId`),
	CONSTRAINT `status_pages_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
ALTER TABLE `status_pages` ADD CONSTRAINT `status_pages_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;