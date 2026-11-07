import { createRouter, createWebHistory } from 'vue-router'
import { auth } from '../firebase'
import InicioPage from '../pages/InicioPage.vue'
import ProyectosPage from '../pages/ProyectosPage.vue'
import KanbanPage from '../pages/KanbanPage.vue'
import LoginView from '../pages/LoginView.vue'

const routes = [
  { path: '/login', name: 'login', component: LoginView },
  { path: '/', name: 'inicio', component: InicioPage },
  { path: '/proyectos', name: 'proyectos', component: ProyectosPage },
  { path: '/proyectos/:id', name: 'kanban', component: KanbanPage },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach((to, _from, next) => {
  // If user is already authenticated and visits /login, redirect to home
  if (to.path === '/login' && auth.currentUser) {
    next({ path: '/' })
  } else {
    next()
  }
})

export default router
