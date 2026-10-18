import { createServer } from "node:http";

const server = createServer((request, response) => {
  if (request.url === "/") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><html><body><h1>Fixture Company builds software tools.</h1><a href=\"/careers\">Careers</a><a href=\"/engineering\">Engineering</a></body></html>");
    return;
  }
  if (request.url === "/careers") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("Fixture Company careers: teams interview engineers about React, TypeScript, collaboration, and product outcomes.");
    return;
  }
  if (request.url === "/engineering") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("Our engineering team builds product interfaces and reviews technical trade-offs.");
    return;
  }
  response.writeHead(404, { "content-type": "text/plain" });
  response.end("Not found");
});

server.listen(4381, "127.0.0.1", () => console.log("Fixture company site listening on 4381"));
