import { collection, addDoc } from 'firebase/firestore'
import { db, auth } from '../firebase'
import type { TicketStatus } from '../types/ticket'

const statusLabel: Record<TicketStatus, string> = {
  'sin-realizar': 'Sin Realizar',
  'en-proceso': 'En Proceso',
  testing: 'Testing',
  completado: 'Completado',
}

/** Mapa para control de frecuencia y prevención de spam/sobrecostos de email */
const emailCooldownMap = new Map<string, number>()
let lastGlobalEmailTime = 0

/**
 * Valida si se puede enviar un correo respetando intervalos de seguridad.
 * Protege contra spam involuntario, clicks repetidos o loops que generen facturación imprevista.
 */
function shouldThrottleEmail(key: string, cooldownMs = 3000): boolean {
  const now = Date.now()
  // Límite global: mínimo 1 segundo entre cualquier envío de correo desde este cliente
  if (now - lastGlobalEmailTime < 1000) {
    return true
  }
  const lastTime = emailCooldownMap.get(key) || 0
  if (now - lastTime < cooldownMs) {
    return true
  }
  emailCooldownMap.set(key, now)
  lastGlobalEmailTime = now
  return false
}

export function getNotificationEmail(): string {
  const uid = auth.currentUser?.uid
  if (uid) {
    const saved = localStorage.getItem(`dev-flow-notification-email_${uid}`)
    if (saved) return saved.trim()
  }
  return auth.currentUser?.email || ''
}

export function setNotificationEmail(email: string) {
  const uid = auth.currentUser?.uid
  if (uid) {
    const clean = email.trim()
    if (clean) {
      localStorage.setItem(`dev-flow-notification-email_${uid}`, clean)
    } else {
      localStorage.removeItem(`dev-flow-notification-email_${uid}`)
    }
  }
}

function emailLayout(title: string, contentHtml: string): string {
  return `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title}</title>
    </head>
    <body style="margin: 0; padding: 24px 12px; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a;">
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
        <tr>
          <td style="height: 4px; background: linear-gradient(90deg, #3b82f6, #6366f1);"></td>
        </tr>
        <tr>
          <td style="padding: 24px 28px 14px 28px; text-align: left;">
            <div style="display: inline-block; font-size: 11px; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase; color: #2563eb; background: #eff6ff; padding: 4px 10px; border-radius: 6px; border: 1px solid #dbeafe;">
              DEV FLOW
            </div>
            <h1 style="margin: 14px 0 0 0; font-size: 19px; font-weight: 700; color: #0f172a; line-height: 1.3;">
              ${title}
            </h1>
          </td>
        </tr>
        <tr>
          <td style="padding: 0 28px 24px 28px;">
            ${contentHtml}
          </td>
        </tr>
        <tr>
          <td style="padding: 14px 28px; background-color: #f8fafc; border-top: 1px solid #f1f5f9; text-align: center;">
            <p style="margin: 0; font-size: 11px; color: #94a3b8; line-height: 1.5;">
              Dev Flow — Plataforma de desarrollo y gestión de proyectos
            </p>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `
}

export function useEmailNotifications() {
  const getUserEmail = (): string | null => {
    return getNotificationEmail() || auth.currentUser?.email || null
  }

  async function sendTicketCreated(
    ticketTitle: string,
    projectName: string,
    ticketDescription?: string,
    toEmail?: string
  ): Promise<boolean> {
    const email = toEmail || getUserEmail()
    if (!email) return false

    const throttleKey = `create_${projectName}_${ticketTitle}`
    if (shouldThrottleEmail(throttleKey, 3000)) {
      return false
    }

    try {
      const content = `
        <p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.6; color: #475569;">
          Se ha creado un nuevo ticket en el proyecto <strong>${projectName}</strong>.
        </p>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
          <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">Ticket</div>
          <div style="font-size: 15px; font-weight: 600; color: #0f172a; margin-top: 2px;">${ticketTitle}</div>

          ${ticketDescription ? `
            <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #e2e8f0;">
              <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">Descripción</div>
              <div style="font-size: 13px; color: #334155; line-height: 1.5; margin-top: 4px; white-space: pre-wrap;">${ticketDescription}</div>
            </div>
          ` : ''}

          <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #e2e8f0;">
            <span style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">Estado</span>
            <div style="margin-top: 4px;"><span style="display: inline-block; font-size: 11px; font-weight: 700; color: #475569; background: #e2e8f0; padding: 2px 8px; border-radius: 4px;">Sin Realizar</span></div>
          </div>
        </div>
      `
      await addDoc(collection(db, 'mail'), {
        to: [email],
        message: {
          subject: `Nuevo ticket: ${ticketTitle}`,
          html: emailLayout('Nuevo ticket creado', content),
        },
      })
      return true
    } catch (e) {
      console.error('sendTicketCreated error:', e)
      return false
    }
  }

  async function sendTicketMoved(
    ticketTitle: string,
    projectName: string,
    fromStatus: TicketStatus,
    toStatus: TicketStatus,
    toEmail?: string
  ) {
    const email = toEmail || getUserEmail()
    if (!email) return

    const throttleKey = `move_${projectName}_${ticketTitle}_${toStatus}`
    if (shouldThrottleEmail(throttleKey, 5000)) {
      return
    }

    try {
      const content = `
        <p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.6; color: #475569;">
          El ticket <strong>${ticketTitle}</strong> cambió de estado en <strong>${projectName}</strong>.
        </p>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
          <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">Ticket</div>
          <div style="font-size: 15px; font-weight: 600; color: #0f172a; margin-top: 2px; margin-bottom: 12px;">${ticketTitle}</div>

          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse;">
            <tr>
              <td style="width: 50%; padding: 8px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 6px 0 0 6px;">
                <div style="font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 600;">Estado anterior</div>
                <div style="font-size: 13px; color: #475569; font-weight: 600; margin-top: 2px;">${statusLabel[fromStatus]}</div>
              </td>
              <td style="width: 50%; padding: 8px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 0 6px 6px 0;">
                <div style="font-size: 11px; color: #2563eb; text-transform: uppercase; font-weight: 700;">Nuevo estado</div>
                <div style="font-size: 13px; color: #1e40af; font-weight: 700; margin-top: 2px;">${statusLabel[toStatus]}</div>
              </td>
            </tr>
          </table>
        </div>
      `
      await addDoc(collection(db, 'mail'), {
        to: [email],
        message: {
          subject: `Ticket actualizado: ${ticketTitle}`,
          html: emailLayout('Actualización de ticket', content),
        },
      })
    } catch (e) {
      console.error('sendTicketMoved error:', e)
    }
  }

  async function sendInviteEmail(
    projectName: string,
    projectId: string,
    inviterName: string,
    toEmail: string,
    workspaceName?: string
  ) {
    const link = `${window.location.origin}/proyectos/${projectId}`
    const throttleKey = `invite_${workspaceName || ''}_${projectId}_${toEmail}`
    if (shouldThrottleEmail(throttleKey, 4000)) {
      return false
    }

    try {
      const content = `
        <p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.6; color: #475569;">
          <strong>${inviterName}</strong> te ha invitado a colaborar en el proyecto <strong>${projectName}</strong>${workspaceName ? ` del área de trabajo <strong>${workspaceName}</strong>` : ''}.
        </p>
        <div style="background: #eff6ff; border: 1px solid #dbeafe; border-radius: 8px; padding: 18px; margin-bottom: 20px; text-align: center;">
          <p style="margin: 0 0 14px 0; font-size: 13px; color: #1e40af; line-height: 1.5;">
            Tendrás permisos para crear, editar y mover tickets en este proyecto.
          </p>
          <a href="${link}" style="display: inline-block; background: #2563eb; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 600; padding: 10px 24px; border-radius: 6px;">
            Ir al proyecto
          </a>
        </div>
        <p style="margin: 0; font-size: 12px; color: #64748b; line-height: 1.5;">
          ¿No tienes cuenta? Al registrarte con este correo (<strong>${toEmail}</strong>) entrarás automáticamente sin necesidad de crear tu propia área de trabajo.
        </p>
      `
      await addDoc(collection(db, 'mail'), {
        to: [toEmail],
        message: {
          subject: `Invitación al proyecto "${projectName}" - Dev Flow`,
          html: emailLayout('Invitación a proyecto', content),
        },
      })
      return true
    } catch (e) {
      console.error('sendInviteEmail error:', e)
      return false
    }
  }

  async function sendProjectAddedEmail(
    projectName: string,
    projectId: string,
    workspaceName: string,
    inviterName: string,
    toEmail: string
  ): Promise<boolean> {
    const link = `${window.location.origin}/proyectos/${projectId}`
    const throttleKey = `proj_add_${projectName}_${toEmail}`
    if (shouldThrottleEmail(throttleKey, 3000)) {
      return false
    }

    try {
      const content = `
        <p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.6; color: #475569;">
          <strong>${inviterName}</strong> te ha otorgado acceso al proyecto <strong>${projectName}</strong> en el área de trabajo <strong>${workspaceName}</strong>.
        </p>
        <div style="background: #eff6ff; border: 1px solid #dbeafe; border-radius: 8px; padding: 18px; margin-bottom: 20px; text-align: center;">
          <p style="margin: 0 0 14px 0; font-size: 13px; color: #1e40af; line-height: 1.5;">
            Ya puedes acceder al tablero kanban y colaborar en los tickets.
          </p>
          <a href="${link}" style="display: inline-block; background: #2563eb; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 600; padding: 10px 24px; border-radius: 6px;">
            Ver proyecto
          </a>
        </div>
      `
      await addDoc(collection(db, 'mail'), {
        to: [toEmail],
        message: {
          subject: `Acceso otorgado al proyecto "${projectName}" - Dev Flow`,
          html: emailLayout('Acceso a proyecto otorgado', content),
        },
      })
      return true
    } catch (e) {
      console.error('sendProjectAddedEmail error:', e)
      return false
    }
  }

  async function sendProjectRemovedEmail(
    projectName: string,
    workspaceName: string,
    inviterName: string,
    toEmail: string
  ): Promise<boolean> {
    const throttleKey = `proj_rem_${projectName}_${toEmail}`
    if (shouldThrottleEmail(throttleKey, 3000)) {
      return false
    }

    try {
      const content = `
        <p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.6; color: #475569;">
          <strong>${inviterName}</strong> ha removido tu acceso al proyecto <strong>${projectName}</strong> en el área de trabajo <strong>${workspaceName}</strong>.
        </p>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 16px;">
          <p style="margin: 0; font-size: 13px; color: #64748b; line-height: 1.5;">
            Ya no podrás ver ni editar los tickets de este proyecto. Si crees que se trata de un error, comunícate con el administrador del área.
          </p>
        </div>
      `
      await addDoc(collection(db, 'mail'), {
        to: [toEmail],
        message: {
          subject: `Acceso revocado en "${projectName}" - Dev Flow`,
          html: emailLayout('Acceso a proyecto revocado', content),
        },
      })
      return true
    } catch (e) {
      console.error('sendProjectRemovedEmail error:', e)
      return false
    }
  }

  async function sendWorkspaceRemovedEmail(
    workspaceName: string,
    inviterName: string,
    toEmail: string
  ): Promise<boolean> {
    const throttleKey = `ws_rem_${workspaceName}_${toEmail}`
    if (shouldThrottleEmail(throttleKey, 3000)) {
      return false
    }

    try {
      const content = `
        <p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.6; color: #475569;">
          <strong>${inviterName}</strong> ha revocado tu acceso a todos los proyectos del área de trabajo <strong>${workspaceName}</strong>.
        </p>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 16px;">
          <p style="margin: 0; font-size: 13px; color: #64748b; line-height: 1.5;">
            Has sido desvinculado de esta área de trabajo.
          </p>
        </div>
      `
      await addDoc(collection(db, 'mail'), {
        to: [toEmail],
        message: {
          subject: `Desvinculación del área de trabajo "${workspaceName}" - Dev Flow`,
          html: emailLayout('Desvinculación de área de trabajo', content),
        },
      })
      return true
    } catch (e) {
      console.error('sendWorkspaceRemovedEmail error:', e)
      return false
    }
  }

  return {
    sendTicketCreated,
    sendTicketMoved,
    sendInviteEmail,
    sendProjectAddedEmail,
    sendProjectRemovedEmail,
    sendWorkspaceRemovedEmail,
  }
}
