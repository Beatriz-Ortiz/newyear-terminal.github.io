# 🎄 Terminal Navideña 2026 ✨

Una terminal interactiva con temática navideña y estilo cyberpunk que te guía a través de una historia interactiva para dar la bienvenida al año nuevo 2026.

## 🌟 Características

- 🖥️ **Interfaz de terminal realista** con efectos de escritura carácter por carácter
- 🎨 **Estilo tecnológico/navideño** con efectos de luces, grid digital y animaciones cyberpunk
- 🎭 **Historia interactiva** basada en máquina de estados con múltiples decisiones
- ⚡ **Efectos visuales avanzados**:
  - Líneas de escaneo tecnológico
  - Luces navideñas animadas en colores festivos
  - Grid digital pulsante
  - Resplandores y brillos dinámicos
  - Estrellas parpadeantes
  - Efectos de "nieve" digital
- 🎮 **Sistema de elecciones** con transiciones suaves
- 🎯 **Tipografía monoespacio** para experiencia auténtica de terminal

## 🚀 Tecnologías

- **Vue 3** - Framework progresivo con Composition API
- **TypeScript** - Tipado estático para mayor robustez
- **Vite** - Build tool ultrarrápido
- **CSS3** - Animaciones y efectos visuales avanzados

## 📦 Instalación

```bash
# Clonar el repositorio
git clone https://github.com/Beatriz-Ortiz/newyear-terminal.git

# Navegar al directorio
cd newyear-terminal

# Instalar dependencias
npm install

# Ejecutar en modo desarrollo
npm run dev

# Construir para producción
npm run build
```

## 🎮 Uso

1. Abre el proyecto en tu navegador (por defecto en `http://localhost:5173`)
2. La historia comenzará automáticamente con efecto de escritura
3. Lee las opciones presentadas
4. Haz clic en los botones o usa los números para seleccionar tu respuesta
5. Disfruta de las animaciones y efectos visuales

## 🎨 Personalización

El proyecto está diseñado de forma modular:

- **Historia**: Modifica `src/story/machine.json` para cambiar la narrativa
- **Estilos**: Ajusta los colores y animaciones en `src/ui/components/TerminalView.vue`
- **Runner**: La lógica del sistema de estados está en `src/runner/TerminalStoryRunner.ts`

## 🏗️ Estructura del Proyecto

```
src/
├── runner/
│   └── TerminalStoryRunner.ts    # Máquina de estados
├── story/
│   └── machine.json               # Definición de la historia
├── ui/
│   └── components/
│       └── TerminalView.vue       # Componente principal de la terminal
├── App.vue
└── main.ts
```

## 🎯 Características Técnicas

- **Sistema de promesas** para control asíncrono de la escritura
- **Cola de impresión** para serializar la salida de texto
- **Animaciones CSS** optimizadas con `will-change` y `transform`
- **Efectos de transición** con Vue `<transition-group>`
- **Diseño responsive** que se adapta a diferentes tamaños de pantalla
- **Tema navideño personalizado** con paleta de colores festivos

## 📝 Licencia

Este proyecto es de código abierto y está disponible bajo la licencia MIT.

## 👤 Autor

**Beatriz Ortiz**

- GitHub: [@Beatriz-Ortiz](https://github.com/Beatriz-Ortiz)

## 🎉 Contribuciones

¡Las contribuciones son bienvenidas! Si tienes ideas para mejorar la terminal o añadir nuevas características, no dudes en abrir un issue o enviar un pull request.

---

_¡Feliz Año Nuevo 2026! 🎊_
