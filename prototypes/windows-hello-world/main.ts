const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Hello World</title>
    <style>
      html, body {
        height: 100%;
        margin: 0;
      }

      body {
        display: grid;
        place-items: center;
        background: #f4f1e8;
        color: #17211b;
        font-family: Georgia, "Times New Roman", serif;
      }

      h1 {
        font-size: clamp(3rem, 10vw, 6rem);
        font-weight: 400;
        letter-spacing: -0.05em;
        margin: 0;
      }
    </style>
  </head>
  <body>
    <h1>Hello World</h1>
  </body>
</html>`;

Deno.serve(() =>
  new Response(page, {
    headers: { "content-type": "text/html; charset=utf-8" },
  })
);
