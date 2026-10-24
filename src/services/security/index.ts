import { config } from '../../config/index.ts';

export class SecurityService {
  // Rate limiting - track command usage per user
  private static rateLimits = new Map<string, Map<string, number[]>>();

  static checkRateLimit(userId: string, command: string, maxRequests: number, windowMs: number): boolean {
    const now = Date.now();
    
    // Get or create user's command history
    if (!this.rateLimits.has(userId)) {
      this.rateLimits.set(userId, new Map());
    }
    
    const userCommands = this.rateLimits.get(userId)!;
    
    // Get or create command timestamps
    if (!userCommands.has(command)) {
      userCommands.set(command, []);
    }
    
    const timestamps = userCommands.get(command)!;
    
    // Remove timestamps outside the window
    const validTimestamps = timestamps.filter(t => now - t < windowMs);
    userCommands.set(command, validTimestamps);
    
    // Check if limit exceeded
    if (validTimestamps.length >= maxRequests) {
      return false;
    }
    
    // Add current timestamp
    validTimestamps.push(now);
    return true;
  }

  static clearRateLimit(userId: string, command?: string): void {
    if (!this.rateLimits.has(userId)) return;
    
    if (command) {
      this.rateLimits.get(userId)!.delete(command);
    } else {
      this.rateLimits.delete(userId);
    }
  }

  // Input validation
  static sanitizeInput(input: string): string {
    // Remove potentially dangerous characters
    return input
      .replace(/[<>]/g, '') // Remove < and >
      .replace(/@everyone/g, '@\u200Beveryone') // Soften @everyone mentions
      .replace(/@here/g, '@\u200Bhere') // Soften @here mentions
      .trim()
      .slice(0, 1000); // Limit length
  }

  static validateUserId(userId: string): boolean {
    // Discord user IDs are snowflakes (18-19 digit numbers)
    return /^\d{17,19}$/.test(userId);
  }

  static validateAmount(amount: number, min: number = 1, max: number = Number.MAX_SAFE_INTEGER): boolean {
    return Number.isInteger(amount) && amount >= min && amount <= max;
  }

  static validatePositiveInteger(amount: number): boolean {
    return Number.isInteger(amount) && amount > 0;
  }

  // Anti-exploit: Check for suspicious activity patterns
  static async checkSuspiciousActivity(userId: string): Promise<boolean> {
    // This could be expanded to check for:
    // - Rapid command usage
    // - Unusual transaction patterns
    // - Multiple failed attempts
    // - IP-based checks (if available)
    
    return false; // Placeholder - implement based on needs
  }

  // Sanitize user mentions in output
  static sanitizeMentions(text: string): string {
    return text
      .replace(/@everyone/g, '@\u200Beveryone')
      .replace(/@here/g, '@\u200Bhere');
  }

  // Check if a number is within safe bounds
  static isSafeNumber(num: number): boolean {
    return num > Number.MIN_SAFE_INTEGER && num < Number.MAX_SAFE_INTEGER;
  }

  // Prevent integer overflow in calculations
  static safeAdd(a: number, b: number): number {
    if (!this.isSafeNumber(a) || !this.isSafeNumber(b)) {
      throw new Error('Number overflow detected');
    }
    
    const result = a + b;
    if (!this.isSafeNumber(result)) {
      throw new Error('Number overflow detected');
    }
    
    return result;
  }

  static safeMultiply(a: number, b: number): number {
    if (!this.isSafeNumber(a) || !this.isSafeNumber(b)) {
      throw new Error('Number overflow detected');
    }
    
    const result = a * b;
    if (!this.isSafeNumber(result)) {
      throw new Error('Number overflow detected');
    }
    
    return result;
  }

  // Clean up old rate limit entries periodically
  static cleanupRateLimits(): void {
    const now = Date.now();
    const windowMs = 5 * 60 * 1000; // 5 minutes
    
    for (const [userId, commands] of this.rateLimits.entries()) {
      for (const [command, timestamps] of commands.entries()) {
        const validTimestamps = timestamps.filter(t => now - t < windowMs);
        
        if (validTimestamps.length === 0) {
          commands.delete(command);
        } else {
          commands.set(command, validTimestamps);
        }
      }
      
      if (commands.size === 0) {
        this.rateLimits.delete(userId);
      }
    }
  }
}
