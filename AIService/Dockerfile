# TaskFlow AIService. Build từ thư mục gốc repo (cần ../shared):
#   docker build -f AIService/Dockerfile -t taskflow-ai:<sha> .
# Không có GEMINI_API_KEY/GROQ_API_KEY/... thì dùng bộ luật nội bộ, không gọi dịch vụ ngoài.
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=5000
COPY AIService/package.json AIService/package-lock.json ./AIService/
RUN npm --prefix AIService ci --omit=dev
COPY shared ./shared
COPY AIService/src ./AIService/src
USER node
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "AIService/src/index.js"]
