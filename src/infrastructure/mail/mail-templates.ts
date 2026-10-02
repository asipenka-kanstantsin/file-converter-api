import { z } from 'zod';

export interface RenderedMail {
  html: string;
  subject: string;
  text: string;
}

const CONFIRMATION_SUBJECTS = {
  registration: 'Confirm your registration',
} as const;

const confirmationVarsSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  expiresInMinutes: z.number().int().positive(),
  link: z.url(),
  purpose: z.enum(['registration']),
});

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Single locale (en, decision H4). Each template validates its variables, so a template can
// never be enqueued with the wrong shape.
export const MAIL_TEMPLATES = {
  'auth.confirmation': {
    render(vars: z.infer<typeof confirmationVarsSchema>): RenderedMail {
      const subject = CONFIRMATION_SUBJECTS[vars.purpose];
      const text = [
        `Your confirmation code: ${vars.code}`,
        '',
        `Or open this link: ${vars.link}`,
        '',
        `The code and the link expire in ${vars.expiresInMinutes} minutes.`,
        'If you did not request this, ignore this e-mail.',
      ].join('\n');
      const html = [
        `<p>Your confirmation code: <strong>${escapeHtml(vars.code)}</strong></p>`,
        `<p>Or <a href="${escapeHtml(vars.link)}">confirm with one click</a>.</p>`,
        `<p>The code and the link expire in ${vars.expiresInMinutes} minutes.</p>`,
        '<p>If you did not request this, ignore this e-mail.</p>',
      ].join('\n');
      return { html, subject, text };
    },
    vars: confirmationVarsSchema,
  },
} as const;

export type MailTemplate = keyof typeof MAIL_TEMPLATES;
export type MailVars<T extends MailTemplate> = z.infer<
  (typeof MAIL_TEMPLATES)[T]['vars']
>;
