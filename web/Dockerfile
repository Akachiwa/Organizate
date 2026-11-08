FROM nginx:alpine

# Configuración del servidor (página + proxy hacia la API)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Archivos de la página
COPY html/ /usr/share/nginx/html/
