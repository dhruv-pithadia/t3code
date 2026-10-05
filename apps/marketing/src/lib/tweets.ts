export type Tweet = {
  handle: string;
  content: string;
  excerpt?: string;
  link: string;
};

// Publish only testimonials that refer to Yantrix itself.
export const tweets: ReadonlyArray<Tweet> = [];
