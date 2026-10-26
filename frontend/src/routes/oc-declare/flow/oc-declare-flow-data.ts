export type OCDeclareMetaData = {
	name: string;
	id: string;
	description?: string;
	/** Left out when empty, as in saves from before tags existed. See `withTags`. */
	tags?: string[];
};
