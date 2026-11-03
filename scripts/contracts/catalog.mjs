import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
  );
}
const decorators = (node) =>
  ts.canHaveDecorators(node)
    ? (ts.getDecorators(node) ?? []).map((d) => d.expression).filter(ts.isCallExpression)
    : [];
const name = (call) => (ts.isIdentifier(call.expression) ? call.expression.text : '');
const literal = (arg) => (arg && ts.isStringLiteral(arg) ? arg.text : '');

export function controllerOperations(root) {
  const operations = [];
  for (const file of files(join(root, 'apps/api/src')).filter((p) =>
    p.endsWith('.controller.ts'),
  )) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    for (const node of source.statements.filter(ts.isClassDeclaration)) {
      const controller = decorators(node).find((d) => name(d) === 'Controller');
      if (!controller) continue;
      const prefix = literal(controller.arguments[0]);
      for (const method of node.members.filter(ts.isMethodDeclaration)) {
        const ds = decorators(method);
        const verb = ds.find((d) => ['Get', 'Post', 'Patch', 'Delete', 'Put'].includes(name(d)));
        if (!verb) continue;
        const url = `/${[prefix, literal(verb.arguments[0])].filter(Boolean).join('/')}`.replace(
          /:([A-Za-z0-9_]+)/g,
          '{$1}',
        );
        const body = method.getText(source).match(/@Body\(zodBody\((\w+)\)\)/)?.[1];
        const code = ds.find((d) => name(d) === 'HttpCode')?.arguments[0]?.getText(source);
        const statuses = {
          'HttpStatus.OK': 200,
          'HttpStatus.CREATED': 201,
          'HttpStatus.ACCEPTED': 202,
          'HttpStatus.NO_CONTENT': 204,
        };
        let status = code ? (statuses[code] ?? Number(code)) : name(verb) === 'Post' ? 201 : 200;
        if (
          method.parameters.some((p) =>
            decorators(p).some((d) => name(d) === 'Res' && d.arguments.length === 0),
          )
        ) {
          const explicit = method
            .getText(source)
            .match(/res\.status\((HttpStatus\.\w+|\d+)\)/)?.[1];
          // Nest sets its POST default before invoking even a raw @Res() handler.
          if (explicit) status = statuses[explicit] ?? Number(explicit);
        }
        const queryCalls = method.parameters.flatMap((p) =>
          decorators(p).filter((d) => name(d) === 'Query'),
        );
        const queries = queryCalls.map((d) => literal(d.arguments[0])).filter(Boolean);
        operations.push({
          method: name(verb).toLowerCase(),
          path: url,
          body,
          status,
          queries,
          untypedQueryObject: queryCalls.some((d) => !literal(d.arguments[0])),
          operationId: `${node.name.text}_${method.name.getText(source)}`,
        });
      }
    }
  }
  const keys = operations.map((o) => `${o.method} ${o.path}`);
  if (new Set(keys).size !== keys.length) throw new Error('Duplicate HTTP routes detected');
  return operations.sort((a, b) => `${a.path}${a.method}`.localeCompare(`${b.path}${b.method}`));
}
