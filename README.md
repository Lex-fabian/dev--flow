# Dev Flow — Sistema de Gestion de Proyectos y Tableros Kanban

Dev Flow es una plataforma web moderna, agil y de alto rendimiento disenada para la gestion de proyectos de desarrollo de software y seguimiento de actividades mediante tableros Kanban interactivos y colaboracion en tiempo real.

Construida con **Vue 3**, **TypeScript**, **Vite** y **Google Firebase**, la aplicacion ofrece arquitectura multi-area de trabajo, gestion de proyectos con limites controlados, sincronizacion colaborativa reactiva, integracion con GitHub y notificaciones por correo electronico.

---

## Tabla de Contenidos

- [Caracteristicas Principales](#caracteristicas-principales)
- [Arquitectura de Areas de Trabajo y Colaboracion](#arquitectura-de-areas-de-trabajo-y-colaboracion)
- [Stack Tecnologico](#stack-tecnologico)
- [Estructura del Proyecto](#estructura-del-proyecto)
- [Requisitos e Instalacion](#requisitos-e-instalacion)
- [Configuracion de Firebase](#configuracion-de-firebase)
- [Notificaciones por Correo](#notificaciones-por-correo)
- [Integracion con GitHub](#integracion-con-github)
- [Modelo de Datos](#modelo-de-datos)
- [Composables y Logica de Negocio](#composables-y-logica-de-negocio)
- [Reglas de Seguridad](#reglas-de-seguridad)
- [Despliegue](#despliegue)

---

## Caracteristicas Principales

### 1. Sistema Multi-Area de Trabajo (Workspaces)
- **Aislamiento de Entornos**: Los usuarios pueden crear hasta un maximo de 5 areas de trabajo independientes (por ejemplo: personal, trabajo, proyectos de clientes o estudio).
- **Limite de 20 Proyectos por Area**: Cada area de trabajo admite hasta 20 proyectos activos con indicadores visuales de uso (`X/20`).
- **Gestion Colaborativa de Miembros**: Los propietarios de cada area pueden vincular colegas a proyectos especificos seleccionandolos mediante casillas de verificacion.

### 2. Flujo de Invitaciones Colaborativas sin Friccion
- **Acceso Directo para Invitados**: Si un usuario es invitado mediante enlace directo (`/proyectos/:id`) o correo electronico, no se le solicita crear un area de trabajo propia.
- **Etiquetado Claro de Invitado**: En el menu lateral y en los selectores desplegables se identifica visualmente como un area compartida con la etiqueta `Invitado`.
- **Control de Permisos**:
  - Los invitados solo pueden colaborar en los proyectos asignados (crear, editar y mover tickets, comentar y ver documentacion).
  - Los invitados **no pueden crear proyectos ni eliminarlos** en el area del anfitrion.
  - Los invitados **no pueden invitar a terceros** por correo ni por enlace.

### 3. Tablero Kanban Colaborativo en Tiempo Real
- **4 Estados de Flujo de Trabajo**: `Sin Realizar`, `En Proceso`, `Testing` y `Completado`.
- **Swimlanes por Prioridad**: Agrupamiento colapsable por prioridad (`Urgente`, `Alta`, `Media`, `Baja`).
- **Sub-Tickets (Jerarquia Padre/Hijo)**: Descomposicion de tareas complejas en sub-actividades con trazabilidad.
- **Gestion de Dependencias**: Relaciones bidireccionales entre tickets (`Bloquea a`, `Depende de`, `Relacionado con`).
- **Fechas y Planificacion**: Rango de fechas con selector de calendario (`CalendarRangePicker`) e identificador visual de tarjetas vencidas.
- **Adjuntos y Comentarios**: Subida de archivos respaldados en Firebase Cloud Storage y discusiones en tiempo real.
- **Sincronizacion Multiusuario**: Visualizacion inmediata de cambios en el tablero entre miembros mediante listeners reactivos de Firestore.

### 4. Integracion con GitHub y Documentacion
- **Deteccion Automatica OAuth**: Si el usuario inicia sesion con GitHub, se aprovechan las credenciales sin requerir ingreso manual de tokens.
- **Almacenamiento Scoped por Usuario**: Los tokens personales se almacenan de forma aislada (`dev-flow-github-token_${uid}`) para evitar conflictos entre cuentas compartidas.
- **Visualizador de Documentacion**: Renderizado del archivo `README.md` del repositorio con fallback automatico a `raw.githubusercontent.com`.
- **Explorador de Archivos**: Arbol de archivos navegable con enlaces directos a la rama predeterminada en GitHub.

### 5. Notificaciones por Correo (Firebase Trigger Email)
- Plantillas de correo estructuradas para Gmail y clientes de correo modernos.
- Alertas inmediatas al crear tickets (incluyendo descripcion detallada), al mover de estado o al modificar los accesos de proyectos de un miembro.

---

## Arquitectura de Areas de Trabajo y Colaboracion

```text
Area de Trabajo (Propietario)
 ├── Ajustes y Vinculacion de Miembros (Solo Owner)
 └── Proyectos (Maximo 20 por area)
      ├── Proyecto A ── Miembro 1 (Invitado), Miembro 2 (Invitado)
      └── Proyecto B ── Miembro 1 (Invitado)
```

### Matriz de Roles:
* **Propietario del Area**: Control total sobre el area de trabajo, creacion y eliminacion de proyectos, vinculacion y desvinculacion de miembros, y generacion de invitaciones.
* **Miembro Invitado**: Acceso enfocado exclusivamente a tareas operativas (crear, editar y mover tickets, registrar comentarios y revisar documentacion) en los proyectos a los que se le ha dado acceso.

---

## Stack Tecnologico

| Capa | Tecnologia | Descripcion |
| :--- | :--- | :--- |
| **Framework UI** | Vue 3 | Composition API con `<script setup>` SFCs |
| **Lenguaje** | TypeScript | Tipado estatico estricto en toda la base de codigo |
| **Bundler / Servidor** | Vite 8 | Compilacion rapida y HMR para desarrollo |
| **Enrutamiento** | Vue Router 4 | Rutas cliente SPA (`/`, `/proyectos/:id`, `/login`) |
| **Base de Datos** | Cloud Firestore | Base de datos NoSQL reactiva en tiempo real |
| **Autenticacion** | Firebase Auth | Proveedores Google, GitHub y Email/Contrasena |
| **Almacenamiento** | Firebase Storage | Custodia segura de archivos adjuntos de tickets |
| **Notificaciones** | Firebase Extensions | Trigger Email procesando la coleccion `mail` |
| **Estilos** | CSS Moderno | CSS Variables, Flexbox, CSS Grid y diseno adaptativo |

---

## Estructura del Proyecto

```text
dev-flow/
├── public/                     # Recursos publicos estaticos y manifiesto
├── src/
│   ├── assets/                 # Logotipos y recursos graficos
│   ├── components/
│   │   └── kanban/             # Componentes del tablero Kanban
│   │       ├── CalendarRangePicker.vue   # Selector de rangos de fechas
│   │       ├── CloseConfirmDialog.vue    # Confirmacion de cierre de tickets
│   │       ├── CommentsSection.vue       # Sistema de comentarios
│   │       ├── FloatingCardMenu.vue      # Menu contextual de tarjeta
│   │       ├── KanbanCard.vue            # Tarjeta individual de ticket
│   │       └── ProjectDrawer.vue         # Panel lateral de proyecto y miembros
│   ├── composables/            # Modulos de logica y estado reactivo
│   │   ├── useActivityLog.ts         # Registro de actividad del proyecto
│   │   ├── useAppNotifications.ts    # Centro de notificaciones del App Bar
│   │   ├── useAvatar.ts              # Foto de perfil del usuario
│   │   ├── useEmailNotifications.ts  # Plantillas y despacho de correos
│   │   ├── useGithubRepo.ts          # Consulta de repositorios y README
│   │   ├── useGithubToken.ts         # Gestion scoped de tokens de GitHub
│   │   ├── useI18n.ts                # Soporte multi-idioma (ES / EN)
│   │   ├── useProjects.ts            # CRUD de proyectos y colaboradores
│   │   ├── useTicketFiles.ts         # Subida de adjuntos a Firebase Storage
│   │   ├── useTickets.ts             # CRUD de tickets y escucha colaborativa
│   │   ├── useUserGithubRepos.ts     # Listado de repositorios del usuario
│   │   └── useWorkspaces.ts          # Gestion de areas propias y compartidas
│   ├── pages/                  # Vistas principales de la aplicacion
│   │   ├── InicioPage.vue            # Panel principal y tablero rapido
│   │   ├── KanbanPage.vue            # Tablero Kanban completo
│   │   ├── LoginView.vue             # Autenticacion y registro
│   │   └── ProyectosPage.vue         # Cuadricula de proyectos
│   ├── types/                  # Definiciones de tipos TypeScript
│   │   ├── project.ts                # Modelos Project y Member
│   │   ├── ticket.ts                 # Modelos Ticket y LinkedTicket
│   │   └── workspace.ts              # Modelo Workspace
│   ├── App.vue                 # Diseno general, barra lateral y modales
│   ├── firebase.ts             # Inicializacion del SDK de Firebase
│   └── main.ts                 # Punto de entrada de la aplicacion
├── firestore.rules             # Reglas de seguridad de Cloud Firestore
├── storage.rules               # Reglas de seguridad de Firebase Storage
├── firebase.json               # Configuracion de servicios de Firebase
└── vite.config.ts              # Configuracion de Vite y compilador
```

---

## Requisitos e Instalacion

### Requisitos Previos
* Node.js v18.0 o superior
* npm v9.0 o superior
* Proyecto activo en Google Firebase con Firestore, Storage y Authentication habilitados

### Pasos de Instalacion

1. Clonar el repositorio:
```bash
git clone https://github.com/tu-usuario/dev-flow.git
cd dev-flow
```

2. Instalar dependencias del proyecto:
```bash
npm install
```

3. Configurar variables de entorno y credenciales en `src/firebase.ts`:
```typescript
const firebaseConfig = {
  apiKey: "TU_API_KEY",
  authDomain: "TU_PROJECT_ID.firebaseapp.com",
  projectId: "TU_PROJECT_ID",
  storageBucket: "TU_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "TU_MESSAGING_SENDER_ID",
  appId: "TU_APP_ID"
}
```

4. Iniciar el servidor de desarrollo:
```bash
npm run dev
```

---

## Reglas de Seguridad (`firestore.rules`)

El esquema de seguridad en `firestore.rules` garantiza el principio de menor privilegio:
- **`workspaces`**: Lectura publica para usuarios autenticados (permite resolver nombres de areas compartidas). Creacion, actualizacion y eliminacion limitadas al propietario del documento (`resource.data.userId == request.auth.uid`).
- **`projects`**: Los propietarios pueden realizar modificaciones integrales. Los miembros invitados pueden auto-incorporarse mediante enlaces actualizando unicamente los arreglos `members` y `memberUids`.
- **`tickets`**: Lectura y modificacion de estados permitida a miembros y propietarios de cada proyecto.

---

## Despliegue

Para desplegar la aplicacion en Firebase Hosting junto con las reglas de seguridad:

```bash
# Compilar paquete de produccion y verificar tipos
npm run build

# Desplegar Hosting y Reglas de Firestore
firebase deploy --only "hosting,firestore:rules"
```

Aplicacion en produccion:
[https://dev-flow-7b197.web.app](https://dev-flow-7b197.web.app)
