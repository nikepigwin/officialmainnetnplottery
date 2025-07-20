FROM denoland/deno:alpine-1.39.1

WORKDIR /app

# Copy your backend code
COPY . .

# Expose the port your app runs on
EXPOSE 3000

# Run the Deno app
CMD ["run", "--allow-net", "--allow-env", "--allow-read", "mainmod.ts"]