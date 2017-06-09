var async = require('async'), 
    _ = require('underscore'), 
    routeParser = require('route-parser')

function Stack () {
  this.routes = []
  this.state = {}
  this.command_queue = []
  this.next_queue = []  
  this.commands = {}  
  this._routes = []
}

const normalizeArguments = (...args) => Array.isArray(args[0]) ? [].concat(args[0], ...args.slice(1)) : args

Stack.prototype.on = function() {  
  const args = normalizeArguments(Array.from(arguments))
  const paths = args.slice(0, -1);
  const callback = args[args.length - 1];
  const registerRoute = assignRouteRegister(this);
  this.commands = paths.reduce((acc, path) => {
    const fns = this.commands[path] && this.commands[path].fns || [];
    const route = this.commands[path].route
    const commandsForPath = this.commands[path] ? this.commands[path] : { fns: []};
    acc[path] = [].concat(commandsForPath, [path, callback]);
    return acc;
  }, {})

  paths.forEach(function(path) {
    registerRoute(path, callback)
  })
}

Stack.prototype.fire = function(path, param2, param3) {

  var state, callback
  //Parse the parameters to figure out what we got: 
  if(_.isFunction(param2)) { 
    callback = param2 //< param2 is the callback. 
    state = this.state //< state was not supplied, so we use the last known.
  }
  else if(_.isFunction(param3)) {
    callback = param3 //< param3 is the callback
    state = param2 //< param2 is assumed to be a fresh state obj
  }
  else if(_.isObject(param2)) {
    //Only a state object was supplied.
    callback = this.next_queue.pop()
    state = param2
  }
  else if(_.isUndefined(param2)) {
    //No params were supplied.
    callback = this.next_queue.pop()
    state = this.state //< TODO: use a pop() pattern like doing iwth next_queue    
  }

  //At this point if there is already a stack._command it means there is
  //a parent fire already in progress. 
  //So we store it so it can be applied after this particular fire completes. 
  if(state._command) this.command_queue.push(state._command)
  var command
  var matchingRoute = _.find(this.routes, function(route) {
    var result = route.route.match(path)    
    command = undefined !== result && result || {}
    command.path = path
    //^ Parses the route; organizing params into a tidy object.
    return result
  })
  
  var that = this

  //Apply command as a property of state. 
  state._command = command

  async.waterfall([
    function(seriesCallback) {
      
      var seedFunction = function(next) { next(null, state) }
      if(matchingRoute) {      
        //Give the waterfall a seed function with null error, parsed/matched route (req), and state: 
        if(!matchingRoute.seeded) { //but only if we haven't already done it: 
          matchingRoute.middleware.unshift({func: seedFunction })      
          matchingRoute.seeded = true      
        } else { //If already seeded, we overwrite the original seed function
          //(because command and state may have changed): 
          matchingRoute.middleware[0].func = seedFunction
        }
        //Create a copy of the middleware stack we are about to run
        //containing only the functions
        //(preparing the data structure for what async.waterfall will expect): 
        var middlewareToRun = _.map(matchingRoute.middleware, function(entry) { return entry.func })

        async.waterfall(middlewareToRun, function(err, state) {
          if(err) return callback(err)
          that.state = state //< Set this as latest state so it's available as prop.
          seriesCallback(null, state)
        })
      } else {
        //(no matching routes found)
        that.state = state 
        seriesCallback(null, state)
      }
    },
    function(state) {
      //Apply any previous state that was saved from before:
      if(that.command_queue.length > 0) state._command = that.command_queue.pop()
      //^ The reason to delete the command is to clear these values so that listeners 
      //listening to a parent command aren't 'passed up' the wrong req after
      // a child fire's callback occcurs. 
      if(_.isFunction(callback)) callback(null, state)                
    }
  ])

  
}

function assignRouteRegister (stack) {
  return function(path, listenerCallback) {

    var route = new routeParser(path)
    var existingRoute = _.find(stack.routes, function(existingRoute) {    
      return existingRoute.route.match(path)      
    })
    
    //The newMiddleware contains two properties; one is the callback
    //the other is the full path so we can later target/override this. 
    var newMiddleware = { func : listenerCallback, path: path }    
    // wildcard paths naturally do not get added to other routes,
    // instead other paths are added to wildcard routes only after they
    // are defined.  Because we want wildcard paths to also work with prior
    // defined routes, then we must add the wildcard paths to the middlewares
    // of the other routes.
    // This could get tricky though, and more testing is needed to make sure
    // this does not introduce even more problems.
    var isWild = (~path.indexOf('*'))
    if (isWild) {
      stack.routes = stack.routes.map(routes => Object.assign({}, routes, {middleware: [...routes.middleware, newMiddleware], wild: true}))      
    }
    //Determine if the route already exists:
    console.log('checking route:', route.spec)
    if(!existingRoute) {
      console.log('create new route:', route.spec)
      console.log('add', path, 'to new route:', route.spec)
      route = { route: route, middleware: [newMiddleware] }
      //Make an entry for it; add to known routes and define middleware array/stack:      
      stack.routes.push(route)
    } else if (isWild) {
      console.log('add WILD', path, 'to existing route:', existingRoute.route.spec)
      //If the route already exists, just push the new middleware into the 
      //existing stack: 
      existingRoute.middleware.push(newMiddleware)
    } else if (~existingRoute.route.spec.indexOf('*')) {
      console.log('add', path, 'to existing WILD route:', existingRoute.route.spec)
      existingRoute.middleware.push(newMiddleware)
    } else {
      console.log('add', path, 'to existing route:', existingRoute.route.spec)
      existingRoute.middleware.push(newMiddleware)
    }
  }
}

module.exports = new Stack()
