// Module resolve hook (module.register) that reports every @kodespire/* specifier
// resolved, so the test can see which codec packages were loaded.
let port;

export function initialize(data) {
  port = data.port;
}

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('@kodespire/')) port.postMessage(specifier);
  return next(specifier, context);
}
