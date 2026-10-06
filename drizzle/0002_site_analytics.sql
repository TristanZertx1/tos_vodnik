CREATE TABLE `cms_page_views` (
	`day` text NOT NULL,
	`path` text NOT NULL,
	`views` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`day`, `path`)
);
