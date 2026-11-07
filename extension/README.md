# Dev Flow for Visual Studio Code

Gestion agil de tickets, sincronizacion colaborativa con GitHub y ramas automaticas directamente dentro de Visual Studio Code.

## Caracteristicas

- **Panel de Tickets en la Barra Lateral**: Visualiza tus tarjetas organizadas en En proceso, Sin realizar, Testing y Completado sin salir de tu editor.
- **Creacion de Ramas en 1 Clic**: Presiona el icono de rama junto a cualquier ticket y VS Code creara y activara automaticamente la rama git.
- **Comandos de Commit Inteligentes**: Copia en un clic el mensaje sugerido con la etiqueta de auto-cierre fixes.
- **Barra de Estado**: Acceso rapido al tablero y estado de tus tareas en la barra inferior.

## Configuracion

1. Abre la paleta de comandos (`Ctrl + Shift + P` o `Cmd + Shift + P`).
2. Escribe y selecciona: `dev->flow: Conectar con dev->flow`.
3. Ingresa tu UID de usuario de tu cuenta dev-flow.
4. Tus tickets se cargaran en el panel izquierdo.

## Automatizacion Git con Git Hooks

Al trabajar en tus ramas con el codigo del ticket, cada vez que hagas un commit, el ticket se vinculara solo y se marcara como Completado al hacer push a GitHub.
