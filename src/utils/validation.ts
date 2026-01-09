export const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

export const validatePassword = (password: string): { valid: boolean; message?: string } => {
  if (password.length < 6) {
    return { valid: false, message: "A senha deve ter pelo menos 6 caracteres" };
  }
  return { valid: true };
};

export const validateName = (name: string): { valid: boolean; message?: string } => {
  if (!name || name.trim().length < 2) {
    return { valid: false, message: "O nome deve ter pelo menos 2 caracteres" };
  }
  return { valid: true };
};

