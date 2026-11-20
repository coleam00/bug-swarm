const integer = new Intl.NumberFormat("en-US");
export const exactScore = (score: number) => integer.format(score);
