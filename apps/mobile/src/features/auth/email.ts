/** Loose email check for the sign-in form; the server is the real judge. */
export const isPlausibleEmail = (email: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());

export const MIN_PASSWORD_LENGTH = 8;
