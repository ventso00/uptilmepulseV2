ALTER TABLE `monitors` ADD `sslIssuer` varchar(255);--> statement-breakpoint
ALTER TABLE `monitors` ADD `sslSubject` varchar(255);--> statement-breakpoint
ALTER TABLE `monitors` ADD `sslValidTo` timestamp;--> statement-breakpoint
ALTER TABLE `ping_logs` ADD `dnsMs` int;--> statement-breakpoint
ALTER TABLE `ping_logs` ADD `tcpMs` int;--> statement-breakpoint
ALTER TABLE `ping_logs` ADD `tlsMs` int;--> statement-breakpoint
ALTER TABLE `ping_logs` ADD `ttfbMs` int;