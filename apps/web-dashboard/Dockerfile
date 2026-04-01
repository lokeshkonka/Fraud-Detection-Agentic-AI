FROM node:20-alpine

WORKDIR /app
COPY package.json tsconfig.json tsconfig.node.json vite.config.ts tailwind.config.js postcss.config.js ./
COPY index.html ./
COPY src ./src
RUN npm install

EXPOSE 3000
CMD ["npm", "run", "dev", "--", "--host", "--port", "3000"]
