import { join } from 'path';

function getHmrString(appName, routerPath, modelPaths = [], container = '#root', enableModel = false) {
  const modelHot = enableModel ? modelPaths.map(modelPath => `
  if (module.hot) {
    const modelNamespaceMap = {};
    modelNamespaceMap['${modelPath}'] = require('${modelPath}').namespace;
    module.hot.accept('${modelPath}', () => {
      try {
        app.unmodel(modelNamespaceMap['${modelPath}']);
        app.model(require('${modelPath}'));
      } catch(e) { console.error(e); }
    });
  }
`).join('\n') : '';
  return `
(function() {
  // Generated by babel-plugin-dva-hmr
  console.log('[HMR] inited with babel-plugin-dva-hmr');
  ${appName}.router(require('${routerPath}'));
  ${appName}.use({
    onHmr(render) {
      if (module.hot) {
        const renderNormally = render;
        const renderException = (error) => {
          const RedBox = require('redbox-react');
          ReactDOM.render(React.createElement(RedBox, { error: error }), document.querySelector('${container}'));
        };
        const newRender = (router) => {
          try {
            renderNormally(router);
          } catch (error) {
            console.error('error', error);
            renderException(error);
          }
        };
        module.hot.accept('${routerPath}', () => {
          const router = require('${routerPath}');
          newRender(router);
        });
      }
    },  
  });
  ${modelHot}
})()
    `;
}

export default function ({ types:t }) {
  const cache = {};
  const modelPaths = {};
  
  function getImportRequirePath(identifierName, scope) {
    if (scope.hasBinding(identifierName)) {
      const binding = scope.bindings[identifierName];
      if (binding) {
        const parent = binding.path.parent;

        if (t.isImportDeclaration(parent)) {
          return parent.source.value;
        } else if (t.isVariableDeclaration(parent)) {
          const declarator = findDeclarator(parent.declarations, identifierName);
          if (declarator && isRequire(declarator.init)) {
            return declarator.init.arguments[0].value;
          }
        }
      }
    }
    return null;
  }

  function isDvaCallExpression(node, scope) {
    return t.isCallExpression(node) &&
        t.isIdentifier(node.callee) &&
        getImportRequirePath(node.callee.name, scope) === 'dva';
  }

  function isDvaInstance(identifierName, scope) {
    if (scope.hasBinding(identifierName)) {
      const binding = scope.bindings[identifierName];
      if (binding) {
        const parent = binding.path.parent;
        if (t.isVariableDeclaration(parent)) {
          const declarator = findDeclarator(parent.declarations, identifierName);
          if (declarator && isDvaCallExpression(declarator.init, scope)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  function isRouterCall(node, scope) {
    if (!t.isMemberExpression(node)) return false;
    const { object, property } = node;
    return (
      ( t.isIdentifier(property) && property.name === 'router' ) &&
      ( t.isIdentifier(object) && isDvaInstance(object.name, scope))
    );
  }

  function isModelCall(node, scope) {
    if (!t.isMemberExpression(node)) return false;
    const { object, property } = node;
    return (
      ( t.isIdentifier(property) && property.name === 'model' ) &&
      ( t.isIdentifier(object) && isDvaInstance(object.name, scope))
    );
  }

  function isRequire(node) {
    return t.isCallExpression(node) &&
        t.isIdentifier(node.callee) &&
        node.callee.name === 'require';
  }

  function findDeclarator(declarations, identifier) {
    for (let d of declarations) {
      if (t.isIdentifier(d.id) && d.id.name === identifier) {
        return d;
      }
    }
  }

  function getRequirePath(node, scope) {
    switch (node.type) {
      case 'CallExpression':
        if (t.isLiteral(node.arguments[0])) {
          return node.arguments[0].value;
        }
        break;
      case 'Identifier':
        const path = getImportRequirePath(node.name, scope);
        if (path) {
          return path;
        }
        break;
      default:
        break;
    }
  }

  return {
    visitor: {
      Program: {
        enter(path) {
          const { filename } = path.hub.file.opts;
          console.log('DELETE===============', filename);
          delete cache[filename];
        },
      },
      CallExpression(path, { opts }) {
        const { filename } = path.hub.file.opts;
        if (cache[filename]) return;
        const { callee, arguments: args } = path.node;
        if (isRouterCall(callee, path.scope)) {
          const routerPath = getRequirePath(args[0], path.scope);
          if (routerPath) {
            cache[filename] = true;
            !opts.quiet && console.info(`[babel-plugin-dva-hmr][INFO] got routerPath ${routerPath}`);
            path.parentPath.replaceWithSourceString(getHmrString(
              callee.object.name,
              routerPath,
              modelPaths[filename],
              opts.container,
              !opts.disableModel,
            ));
          } else {
            !opts.quiet && console.warn(`[babel-plugin-dva-hmr][WARN] can't get router path in ${filename}`);
          }
        } else if (isModelCall(callee, path.scope)) {
          modelPaths[filename] = modelPaths[filename] || [];
          modelPaths[filename].push(getRequirePath(args[0], path.scope));
        }
      },
    },
  };
}
