"use strict";

require("6to5/polyfill");
var Promise = require("bluebird");
module.exports = function (R) {
  var io = require("socket.io");
  var _ = require("lodash");
  var assert = require("assert");
  var co = require("co");
  var EventEmitter = require("events").EventEmitter;
  var bodyParser = require("body-parser");

  /**
  * <p> SimpleUplinkServer represents an uplink-server that will be able to store data via an other server.<br />
  * There also will be able to notify each client who suscribes to a data when an update will occurs thanks to socket </p>
  * <p> SimpleUplinkServer will be requested by GET or POST via R.Uplink server-side and client-side
  * @class R.SimpleUplinkServer
  */
  var SimpleUplinkServer = {
    /**
    * <p> Initializes the SimpleUplinkServer according to the specifications provided </p>
    * @method createApp
    * @param {object} specs All the specifications of the SimpleUplinkServer
    * @return {SimpleUplinkServerInstance} SimpleUplinkServerInstance The instance of the created SimpleUplinkServer
    */
    createServer: function createServer(specs) {
      R.Debug.dev(function () {
        assert(specs.store && _.isArray(specs.store), "R.SimpleUplinkServer.createServer(...).specs.store: expecting Array.");
        assert(specs.events && _.isArray(specs.events), "R.SimpleUplinkServer.createServer(...).specs.events: expecting Array.");
        assert(specs.actions && _.isPlainObject(specs.actions), "R.SimpleUplinkServer.createServer(...).specs.actions: expecting Object.");
        assert(specs.sessionCreated && _.isFunction(specs.sessionCreated), "R.SimpleUplinkServer.createServer(...).specs.sessionCreated: expecting Function.");
        assert(specs.sessionDestroyed && _.isFunction(specs.sessionDestroyed), "R.SimpleUplinkServer.createServer(...).specs.sessionDestroyed: expecting Function.");
        assert(specs.sessionTimeout && _.isNumber(specs.sessionTimeout), "R.SimpleUplinkServer.createServer(...).specs.sessionTimeout: expecting Number.");
      });
      var SimpleUplinkServerInstance = function SimpleUplinkServerInstance() {
        SimpleUplinkServer.SimpleUplinkServerInstance.call(this);
        this._specs = specs;
        this._pid = R.guid("SimpleUplinkServer");
      };
      _.extend(SimpleUplinkServerInstance.prototype, SimpleUplinkServer.SimpleUplinkServerInstance.prototype, specs);
      return SimpleUplinkServerInstance;
    },
    /**
    * <p> Setting up necessary methods for the SimpleUplinkServer </p>
    * @method SimpleUplinkServerInstance
    */
    SimpleUplinkServerInstance: function SimpleUplinkServerInstance() {
      this._store = {};
      this._hashes = {};
      this._storeRouter = new R.Router();
      this._storeRouter.def(_.constant({
        err: "Unknown store key" }));
      this._storeEvents = new EventEmitter();
      this._eventsRouter = new R.Router();
      this._eventsRouter.def(_.constant({
        err: "Unknown event name" }));
      this._eventsEvents = new EventEmitter();
      this._actionsRouter = new R.Router();
      this._actionsRouter.def(_.constant({
        err: "Unknown action" }));
      this._sessions = {};
      this._sessionsEvents = new EventEmitter();
      this._connections = {};

      this._linkSession = R.scope(this._linkSession, this);
      this._unlinkSession = R.scope(this._unlinkSession, this);
    },
    _SimpleUplinkServerInstanceProtoProps: /** @lends R.SimpleUplinkServer.SimpleUplinkServerInstance.prototype */{
      _specs: null,
      _pid: null,
      _prefix: null,
      _app: null,
      _io: null,
      _store: null,
      _storeEvents: null,
      _storeRouter: null,
      _eventsRouter: null,
      _eventsEvents: null,
      _actionsRouter: null,
      _sessions: null,
      _sessionsEvents: null,
      _connections: null,
      bootstrap: null,
      sessionCreated: null,
      sessionDestroyed: null,
      sessionTimeout: null,
      /**
      * <p>Saves data in store.
      * Called by another server that will provide data for each updated data </p>
      * @method setStore
      * @param {string} key The specified key to set
      * @param {string} val The value to save
      * @return {function} 
      */
      setStore: function setStore(key, val) {
        return R.scope(function (fn) {
          try {
            var previousVal = this._store[key] || {};
            var previousHash = this._hashes[key] || R.hash(JSON.stringify(previousVal));
            var diff = R.diff(previousVal, val);
            var hash = R.hash(JSON.stringify(val));
            this._store[key] = val;
            this._hashes[key] = hash;
            this._storeEvents.emit("set:" + key, {
              k: key,
              d: diff,
              h: previousHash });
          } catch (err) {
            return fn(R.Debug.extendError(err, "R.SimpleUplinkServer.setStore('" + key + "', '" + val + "')"));
          }
          _.defer(function () {
            fn(null, val);
          });
        }, this);
      },

      /**
      * <p> Provides data from store. <br />
      * Called when the fetching data occurs. <br />
      * Requested by GET from R.Store server-side or client-side</p>
      * @method getStore
      * @param {string} key The specified key to set
      * @return {function} 
      */
      getStore: function getStore(key) {
        return R.scope(function (fn) {
          var val;
          try {
            R.Debug.dev(R.scope(function () {
              if (!_.has(this._store, key)) {
                console.warn("R.SimpleUplinkServer(...).getStore: no such key (" + key + ")");
              }
            }, this));
            val = this._store[key];
          } catch (err) {
            return fn(R.Debug.extendError(err, "R.SimpleUplinkServer.getStore('" + key + "')"));
          }
          _.defer(function () {
            fn(null, val);
          });
        }, this);
      },
      /**
      * @method emitEvent
      * @param {string} eventName
      * @param {object} params
      */
      emitEvent: function emitEvent(eventName, params) {
        this._eventsEvents.emit("emit:" + eventName, params);
      },
      /**
      * @method emitDebug
      * @param {string} guid
      * @param {object} params
      */
      emitDebug: function emitDebug(guid, params) {
        R.Debug.dev(R.scope(function () {
          if (this._sessions[guid]) {
            this._sessions[guid].emit("debug", params);
          }
        }, this));
      },
      /**
      * @method emitLog
      * @param {string} guid
      * @param {object} params
      */
      emitLog: function emitLog(guid, params) {
        if (this._sessions[guid]) {
          this._sessions[guid].emit("log", params);
        }
      },
      /**
      * @method emitWarn
      * @param {string} guid
      * @param {object} params
      */
      emitWarn: function emitLog(guid, params) {
        if (this._sessions[guid]) {
          this._sessions[guid].emit("warn", params);
        }
      },
      /**
      * @method emitError
      * @param {string} guid
      * @param {object} params
      */
      emitError: function emitLog(guid, params) {
        if (this._sessions[guid]) {
          this._sessions[guid].emit("err", params);
        }
      },
      _extractOriginalPath: function _extractOriginalPath() {
        return arguments[arguments.length - 1];
      },
      _bindStoreRoute: function _bindStoreRoute(route) {
        this._storeRouter.route(route, this._extractOriginalPath);
      },
      _bindEventsRoute: function _bindEventsRoute(route) {
        this._eventsRouter.route(route, this._extractOriginalPath);
      },
      _bindActionsRoute: function _bindActionsRoute(handler, route) {
        this._actionsRouter.route(route, _.constant(R.scope(handler, this)));
      },
      /** 
      * <p> Setting up UplinkServer. <br />
      * - create the socket connection <br />
      * - init get and post app in order to provide data via R.Uplink.fetch</p>
      * @method installHandlers
      * @param {object} app The specified App
      * @param {string} prefix The prefix string that will be requested. Tipically "/uplink"
      */
      installHandlers: regeneratorRuntime.mark(function installHandlers(app, prefix) {
        var server;
        return regeneratorRuntime.wrap(function installHandlers$(context$2$0) {
          while (1) switch (context$2$0.prev = context$2$0.next) {
            case 0:

              assert(this._app === null, "R.SimpleUplinkServer.SimpleUplinkServerInstance.installHandlers(...): app already mounted.");
              this._app = app;
              this._prefix = prefix || "/uplink/";
              server = require("http").Server(app);

              this._io = io(server).of(prefix);
              this._app.get(this._prefix + "*", R.scope(this._handleHttpGet, this));
              this._app.post(this._prefix + "*", bodyParser.json(), R.scope(this._handleHttpPost, this));
              this._io.on("connection", R.scope(this._handleSocketConnection, this));
              this._handleSocketDisconnection = R.scope(this._handleSocketDisconnection, this);
              this._sessionsEvents.addListener("expire", R.scope(this._handleSessionExpire, this));
              _.each(this._specs.store, R.scope(this._bindStoreRoute, this));
              _.each(this._specs.events, R.scope(this._bindEventsRoute, this));
              _.each(this._specs.actions, R.scope(this._bindActionsRoute, this));
              this.bootstrap = R.scope(this._specs.bootstrap, this);
              context$2$0.next = 16;
              return this.bootstrap();

            case 16: return context$2$0.abrupt("return", server);
            case 17:
            case "end": return context$2$0.stop();
          }
        }, installHandlers, this);
      }),
      /**
      * <p>Return the saved data from store</p>
      * <p>Requested from R.Store server-side or client-side</p>
      * @method _handleHttpGet
      * @param {object} req The classical request
      * @param {object} res The response to send
      * @param {object} next
      * @return {string} val The computed json value
      */
      _handleHttpGet: function _handleHttpGet(req, res, next) {
        co(regeneratorRuntime.mark(function callee$2$0() {
          var path, key;
          return regeneratorRuntime.wrap(function callee$2$0$(context$3$0) {
            while (1) switch (context$3$0.prev = context$3$0.next) {
              case 0:
                path = req.path.slice(this._prefix.length - 1);
                key = this._storeRouter.match(path);

                R.Debug.dev(function () {
                  console.warn("<<< fetch", path);
                });
                context$3$0.next = 5;
                return this.getStore(key);

              case 5: return context$3$0.abrupt("return", context$3$0.sent);
              case 6:
              case "end": return context$3$0.stop();
            }
          }, callee$2$0, this);
        })).call(this, function (err, val) {
          if (err) {
            if (R.Debug.isDev()) {
              return res.status(500).json({ err: err.toString(), stack: err.stack });
            } else {
              return res.status(500).json({ err: err.toString() });
            }
          } else {
            return res.status(200).json(val);
          }
        });
      },
      /**
      * @method _handleHttpPost
      * @param {object} req The classical request
      * @param {object} res The response to send
      * @return {string} str
      */
      _handleHttpPost: function _handleHttpPost(req, res) {
        co(regeneratorRuntime.mark(function callee$2$0() {
          var path, handler, params;
          return regeneratorRuntime.wrap(function callee$2$0$(context$3$0) {
            while (1) switch (context$3$0.prev = context$3$0.next) {
              case 0:
                path = req.path.slice(this._prefix.length - 1);
                handler = this._actionsRouter.match(path);

                assert(_.isObject(req.body), "body: expecting Object.");
                assert(req.body.guid && _.isString(req.body.guid), "guid: expecting String.");
                assert(req.body.params && _.isPlainObject(req.body.params), "params: expecting Object.");

                if (_.has(this._sessions, req.body.guid)) {
                  context$3$0.next = 9;
                  break;
                }

                this._sessions[guid] = new R.SimpleUplinkServer.Session(guid, this._storeEvents, this._eventsEvents, this._sessionsEvents, this.sessionTimeout);
                context$3$0.next = 9;
                return this.sessionCreated(guid);

              case 9:
                params = _.extend({}, { guid: req.body.guid }, req.body.params);

                R.Debug.dev(function () {
                  console.warn("<<< action", path, params);
                });
                context$3$0.next = 13;
                return handler(params);

              case 13: return context$3$0.abrupt("return", context$3$0.sent);
              case 14:
              case "end": return context$3$0.stop();
            }
          }, callee$2$0, this);
        })).call(this, function (err, val) {
          if (err) {
            if (R.Debug.isDev()) {
              return res.status(500).json({ err: err.toString(), stack: err.stack });
            } else {
              return res.status(500).json({ err: err.toString() });
            }
          } else {
            res.status(200).json(val);
          }
        });
      },
      /** 
      * <p> Create a R.SimpleUplinkServer.Connection in order to set up handler items. <br />
      * Triggered when a socket connection is established </p>
      * @method _handleSocketConnection
      * @param {Object} socket The socket used in the connection
      */
      _handleSocketConnection: function _handleSocketConnection(socket) {
        var connection = new R.SimpleUplinkServer.Connection(this._pid, socket, this._handleSocketDisconnection, this._linkSession, this._unlinkSession);
        this._connections[connection.uniqueId] = connection;
      },

      /** 
      * <p> Destroy a R.SimpleUplinkServer.Connection. <br />
      * Triggered when a socket connection is closed </p>
      * @method _handleSocketDisconnection
      * @param {string} uniqueId The unique Id of the connection
      */
      _handleSocketDisconnection: function _handleSocketDisconnection(uniqueId) {
        var guid = this._connections[uniqueId].guid;
        if (guid && this._sessions[guid]) {
          this._sessions[guid].detachConnection();
        }
        delete this._connections[uniqueId];
      },

      /** 
      * <p>Link a Session in order to set up subscribing and unsubscribing methods uplink-server-side</p>
      * @method _linkSession
      * @param {SimpleUplinkServer.Connection} connection The created connection
      * @param {string} guid Unique string GUID
      * @return {object} the object that contains methods subscriptions/unsubscriptions
      */
      _linkSession: regeneratorRuntime.mark(function _linkSession(connection, guid) {
        return regeneratorRuntime.wrap(function _linkSession$(context$2$0) {
          while (1) switch (context$2$0.prev = context$2$0.next) {
            case 0:

              if (this._sessions[guid]) {
                context$2$0.next = 4;
                break;
              }

              this._sessions[guid] = new R.SimpleUplinkServer.Session(guid, this._storeEvents, this._eventsEvents, this._sessionsEvents, this.sessionTimeout);
              context$2$0.next = 4;
              return this.sessionCreated(guid);

            case 4: return context$2$0.abrupt("return", this._sessions[guid].attachConnection(connection));
            case 5:
            case "end": return context$2$0.stop();
          }
        }, _linkSession, this);
      }),

      /** 
      * <p>Unlink a Session</p>
      * @method _unlinkSession
      * @param {SimpleUplinkServer.Connection} connection 
      * @param {string} guid Unique string GUID
      * @return {Function} fn
      */
      _unlinkSession: function _unlinkSession(connection, guid) {
        return R.scope(function (fn) {
          try {
            if (this._sessions[guid]) {
              this._sessions[guid].terminate();
            }
          } catch (err) {
            return fn(R.Debug.extendError("R.SimpleUplinkServerInstance._unlinkSession(...)"));
          }
          return fn(null);
        }, this);
      },
      /** 
      * @method _handleSessionExpire
      * @param {string} guid Unique string GUID
      */
      _handleSessionExpire: function _handleSessionExpire(guid) {
        R.Debug.dev(R.scope(function () {
          assert(_.has(this._sessions, guid), "R.SimpleUplinkServer._handleSessionExpire(...): no such session.");
        }, this));
        delete this._sessions[guid];
        co(regeneratorRuntime.mark(function callee$2$0() {
          return regeneratorRuntime.wrap(function callee$2$0$(context$3$0) {
            while (1) switch (context$3$0.prev = context$3$0.next) {
              case 0:
                context$3$0.next = 2;
                return this.sessionDestroyed(guid);

              case 2:
              case "end": return context$3$0.stop();
            }
          }, callee$2$0, this);
        })).call(this, R.Debug.rethrow("R.SimpleUplinkServer._handleSessionExpire(...)"));
      } },
    /** 
    * <p>Setting up a connection in order to initialies methods and to provides specifics listeners on the socket</p>
    * @method Connection
    * @param {object} pid 
    * @param {object} socket
    * @param {object} handleSocketDisconnection
    * @param {object} linkSession 
    * @param {object} unlinkSession
    */
    Connection: function Connection(pid, socket, handleSocketDisconnection, linkSession, unlinkSession) {
      this._pid = pid;
      this.uniqueId = _.uniqueId("R.SimpleUplinkServer.Connection");
      this._socket = socket;
      this._handleSocketDisconnection = handleSocketDisconnection;
      this._linkSession = linkSession;
      this._unlinkSession = unlinkSession;
      this._bindHandlers();
    },
    _ConnectionProtoProps: /** @lends R.SimpleUplinkServer.Connection.prototype */{
      _socket: null,
      _pid: null,
      uniqueId: null,
      guid: null,
      _handleSocketDisconnection: null,
      _linkSession: null,
      _unlinkSession: null,
      _subscribeTo: null,
      _unsubscribeFrom: null,
      _listenTo: null,
      _unlistenFrom: null,
      _disconnected: null,
      /** 
      * <p>Setting up the specifics listeners for the socket</p>
      * @method _bindHandlers
      */
      _bindHandlers: function _bindHandlers() {
        this._socket.on("handshake", R.scope(this._handleHandshake, this));
        this._socket.on("subscribeTo", R.scope(this._handleSubscribeTo, this));
        this._socket.on("unsubscribeFrom", R.scope(this._handleUnsubscribeFrom, this));
        this._socket.on("listenTo", R.scope(this._handleListenTo, this));
        this._socket.on("unlistenFrom", R.scope(this._handleUnlistenFrom, this));
        this._socket.on("disconnect", R.scope(this._handleDisconnect, this));
        this._socket.on("unhandshake", R.scope(this._handleUnHandshake, this));
      },
      /**
      * <p> Simply emit a specific action on the socket </p>
      * @method emit
      * @param {string} name The name of the action to send
      * @param {object} params The params 
      */
      emit: function emit(name, params) {
        R.Debug.dev(function () {
          console.warn("[C] >>> " + name, params);
        });
        this._socket.emit(name, params);
      },
      /**
      * <p> Triggered by the recently connected client. <br />
      * Combines methods of subscriptions that will be triggered by the client via socket listening</p>
      * @method _handleHandshake
      * @param {String} params Contains the unique string GUID
      */
      _handleHandshake: function _handleHandshake(params) {
        if (!_.has(params, "guid") || !_.isString(params.guid)) {
          this.emit("err", { err: "handshake.params.guid: expected String." });
        } else if (this.guid) {
          this.emit("err", { err: "handshake: session already linked." });
        } else {
          co(regeneratorRuntime.mark(function callee$2$0() {
            var s;
            return regeneratorRuntime.wrap(function callee$2$0$(context$3$0) {
              while (1) switch (context$3$0.prev = context$3$0.next) {
                case 0:

                  this.guid = params.guid;
                  context$3$0.next = 3;
                  return this._linkSession(this, this.guid);

                case 3:
                  s = context$3$0.sent;

                  this.emit("handshake-ack", {
                    pid: this._pid,
                    recovered: s.recovered });
                  this._subscribeTo = s.subscribeTo;
                  this._unsubscribeFrom = s.unsubscribeFrom;
                  this._listenTo = s.listenTo;
                  this._unlistenFrom = s.unlistenFrom;

                case 9:
                case "end": return context$3$0.stop();
              }
            }, callee$2$0, this);
          })).call(this, R.Debug.rethrow("R.SimpleUplinkServer.Connection._handleHandshake(...)"));
        }
      },
      /**
      * <p> Triggered by the recently disconnected client. <br />
      * Removes methods of subscriptions</p>
      * @method _handleHandshake
      */
      _handleUnHandshake: function _handleUnHandshake() {
        if (!this.guid) {
          this.emit("err", { err: "unhandshake: no active session." });
        } else {
          co(regeneratorRuntime.mark(function callee$2$0() {
            var s;
            return regeneratorRuntime.wrap(function callee$2$0$(context$3$0) {
              while (1) switch (context$3$0.prev = context$3$0.next) {
                case 0:

                  this._subscribeTo = null;
                  this._unsubscribeFrom = null;
                  this._listenTo = null;
                  this._unlistenFrom = null;
                  context$3$0.next = 6;
                  return this._unlinkSession(this, this.guid);

                case 6:
                  s = context$3$0.sent;

                  this.emit("unhandshake-ack");
                  this.guid = null;

                case 9:
                case "end": return context$3$0.stop();
              }
            }, callee$2$0, this);
          })).call(this, R.Debug.rethrow("R.SimpleUplinkServer.Connection._handleUnHandshake(...)"));
        }
      },
      /** 
      * <p>Maps the triggered event with the _subscribeTo methods </p>
      * @method _handleSubscribeTo
      * @param {object} params Contains the key provided by client
      */
      _handleSubscribeTo: function _handleSubscribeTo(params) {
        if (!_.has(params, "key") || !_.isString(params.key)) {
          this.emit("err", { err: "subscribeTo.params.key: expected String." });
        } else if (!this._subscribeTo) {
          this.emit("err", { err: "subscribeTo: requires handshake." });
        } else {
          this._subscribeTo(params.key);
        }
      },
      /** 
      * <p>Maps the triggered event with the _unsubscribeFrom methods</p>
      * @method _handleUnsubscribeFrom
      * @param {object} params Contains the key provided by client
      */
      _handleUnsubscribeFrom: function _handleUnsubscribeFrom(params) {
        if (!_.has(params, "key") || !_.isString(params.key)) {
          this.emit("err", { err: "unsubscribeFrom.params.key: expected String." });
        } else if (!this._unsubscribeFrom) {
          this.emit("err", { err: "unsubscribeFrom: requires handshake." });
        } else {
          this._unsubscribeFrom(params.key);
        }
      },
      /** 
      * <p>Maps the triggered event with the listenTo methods</p>
      * @method _handleListenTo
      * @param {object} params Contains the eventName provided by client
      */
      _handleListenTo: function _handleListenTo(params) {
        if (!_.has(params, "eventName") || !_.isString(params.eventName)) {
          this.emit("err", { err: "listenTo.params.eventName: expected String." });
        } else if (!this._listenTo) {
          this.emit("err", { err: "listenTo: requires handshake." });
        } else {
          this.listenTo(params.eventName);
        }
      },
      /** 
      * <p>Maps the triggered event with the unlistenFrom methods</p>
      * @method _handleUnlistenFrom
      * @param {object} params Contains the eventName provided by client
      */
      _handleUnlistenFrom: function _handleUnlistenFrom(params) {
        if (!_.has(params, "eventName") || !_.isString(params.eventName)) {
          this.emit("err", { err: "unlistenFrom.params.eventName: expected String." });
        } else if (!this.unlistenFrom) {
          this._emit("err", { err: "unlistenFrom: requires handshake." });
        } else {
          this.unlistenFrom(params.eventName);
        }
      },
      /** 
      * <p>Triggered by the recently disconnected client.</p>
      * @method _handleDisconnect
      */
      _handleDisconnect: function _handleDisconnect() {
        this._handleSocketDisconnection(this.uniqueId, false);
      } },
    /** 
    * <p>Setting up a session</p>
    * @method Session
    * @param {object} pid 
    * @param {object} storeEvents
    * @param {object} eventsEvents
    * @param {object} sessionsEvents 
    * @param {object} timeout
    */
    Session: function Session(guid, storeEvents, eventsEvents, sessionsEvents, timeout) {
      this._guid = guid;
      this._storeEvents = storeEvents;
      this._eventsEvents = eventsEvents;
      this._sessionsEvents = sessionsEvents;
      this._messageQueue = [];
      this._timeoutDuration = timeout;
      this._expire = R.scope(this._expire, this);
      this._expireTimeout = setTimeout(this._expire, this._timeoutDuration);
      this._subscriptions = {};
      this._listeners = {};
    },
    _SessionProtoProps: /** @lends R.SimpleUplinkServer.Session.prototype */{
      _guid: null,
      _connection: null,
      _subscriptions: null,
      _listeners: null,
      _storeEvents: null,
      _eventsEvents: null,
      _sessionsEvents: null,
      _messageQueue: null,
      _expireTimeout: null,
      _timeoutDuration: null,
      /**
      * <p>Bind the subscribing and unsubscribing methods when a connection is established <br />
      * Methods that trigger on client issues (like emit("subscribeTo"), emit("unsubscribeFrom"))</p>
      * @method attachConnection
      * @param {SimpleUplinkServer.Connection} connection the current created connection
      * @return {object} the binded object with methods
      */
      attachConnection: function attachConnection(connection) {
        var recovered = (this._connection !== null);
        this.detachConnection();
        this._connection = connection;
        _.each(this._messageQueue, function (m) {
          connection.emit(m.name, m.params);
        });
        this._messageQueue = null;
        clearTimeout(this._expireTimeout);
        return {
          recovered: recovered,
          subscribeTo: R.scope(this.subscribeTo, this),
          unsubscribeFrom: R.scope(this.unsubscribeFrom, this),
          listenTo: R.scope(this.listenTo, this),
          unlistenFrom: R.scope(this.unlistenFrom, this) };
      },
      /**
      * <p>Remove the previously added connection, and clean the message queue </p>
      * @method detachConnection
      */
      detachConnection: function detachConnection() {
        if (this._connection === null) {
          return;
        } else {
          this._connection = null;
          this._messageQueue = [];
          this._expireTimeout = setTimeout(this._expire, this._timeoutDuration);
        }
      },
      /**
      * @method terminate
      */
      terminate: function terminate() {
        this._expire();
      },
      /** 
      * <p>Method invoked by client via socket emit <br />
      * Store the _signalUpdate method in subscription <br />
      * Add a listener that will call _signalUpdate when triggered </p>
      * @method subscribeTo
      * @param {string} key The key to subscribe
      */
      subscribeTo: function subscribeTo(key) {
        R.Debug.dev(R.scope(function () {
          assert(!_.has(this._subscriptions, key), "R.SimpleUplinkServer.Session.subscribeTo(...): already subscribed.");
        }, this));
        this._subscriptions[key] = this._signalUpdate();
        this._storeEvents.addListener("set:" + key, this._subscriptions[key]);
      },

      /** 
      * <p>Method invoked by client via socket emit <br />
      * Remove a listener according to the key</p>
      * @method subscribeTo
      * @param {string} key The key to unsubscribe
      */
      unsubscribeFrom: function unsubscribeFrom(key) {
        R.Debug.dev(R.scope(function () {
          assert(_.has(this._subscriptions, key), "R.SimpleUplinkServer.Session.unsubscribeFrom(...): not subscribed.");
        }, this));
        this._storeEvents.removeListener("set:" + key, this._subscriptions[key]);
        delete this._subscriptions[key];
      },
      /**
      * <p> Simply emit a specific action on the socket </p>
      * @method _emit
      * @param {string} name The name of the action to send
      * @param {object} params The params 
      */
      _emit: function _emit(name, params) {
        R.Debug.dev(function () {
          console.warn("[S] >>> " + name, params);
        });
        if (this._connection !== null) {
          this._connection.emit(name, params);
        } else {
          this._messageQueue.push({
            name: name,
            params: params });
        }
      },
      /** <p>Push an update action on the socket. <br />
      * The client is listening on the action "update" socket </p>
      * @method _signalUpdate
      */
      _signalUpdate: function _signalUpdate() {
        return R.scope(function (patch) {
          this._emit("update", patch);
        }, this);
      },
      /** <p>Push an event action on the socket. <br />
      * The client is listening on the action "event" socket </p>
      * @method _signalEvent
      */
      _signalEvent: function _signalEvent(eventName) {
        return R.scope(function (params) {
          this._emit("event", { eventName: eventName, params: params });
        }, this);
      },
      /**
      * @method _expire
      */
      _expire: function _expire() {
        _.each(_.keys(this._subscriptions), R.scope(this.unsubscribeFrom, this));
        _.each(_.keys(this._listeners), R.scope(this.unlistenFrom, this));
        this._sessionsEvents.emit("expire", this._guid);
      },
      /**
      * <p> Create a listener for the events </p>
      * @method listenTo
      * @param {string} eventName The name of the event that will be registered
      */
      listenTo: function listenTo(eventName) {
        R.Debug.dev(R.scope(function () {
          assert(!_.has(this._listeners, key), "R.SimpleUplinkServer.Session.listenTo(...): already listening.");
        }, this));
        this._listeners[eventName] = this._signalEvent(eventName);
        this._eventsEvents.addListener("emit:" + eventName, this._listeners[eventName]);
      },
      /**
      * <p> Remove a listener from the events </p>
      * @method unlistenFrom
      * @param {string} eventName The name of the event that will be unregistered
      */
      unlistenFrom: function unlistenFrom(eventName) {
        R.Debug.dev(R.scope(function () {
          assert(_.has(this._listeners, eventName), "R.SimpleUplinkServer.Session.unlistenFrom(...): not listening.");
        }, this));
        this._eventsEvents.removeListener("emit:" + eventName, this._listeners[eventName]);
        delete this._listeners[eventName];
      } } };

  _.extend(SimpleUplinkServer.SimpleUplinkServerInstance.prototype, SimpleUplinkServer._SimpleUplinkServerInstanceProtoProps);
  _.extend(SimpleUplinkServer.Connection.prototype, SimpleUplinkServer._ConnectionProtoProps);
  _.extend(SimpleUplinkServer.Session.prototype, SimpleUplinkServer._SessionProtoProps);

  return SimpleUplinkServer;
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImQ6L1Byb2pldHMvbWlsbGVuaXVtX3NjaG9vbC9uZXh1cy11cGxpbmstc2ltcGxlLXNlcnZlci9uZXh1cy11cGxpbmstc2ltcGxlLXNlcnZlci9zcmMvaW5kZXguanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSxPQUFPLENBQUMsZUFBZSxDQUFDLENBQUM7QUFDekIsSUFBSSxPQUFPLEdBQUcsT0FBTyxDQUFDLFVBQVUsQ0FBQyxDQUFDO0FBQ2xDLE1BQU0sQ0FBQyxPQUFPLEdBQUcsVUFBUyxDQUFDLEVBQUU7QUFDekIsTUFBSSxFQUFFLEdBQUcsT0FBTyxDQUFDLFdBQVcsQ0FBQyxDQUFDO0FBQzlCLE1BQUksQ0FBQyxHQUFHLE9BQU8sQ0FBQyxRQUFRLENBQUMsQ0FBQztBQUMxQixNQUFJLE1BQU0sR0FBRyxPQUFPLENBQUMsUUFBUSxDQUFDLENBQUM7QUFDL0IsTUFBSSxFQUFFLEdBQUcsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFDO0FBQ3ZCLE1BQUksWUFBWSxHQUFHLE9BQU8sQ0FBQyxRQUFRLENBQUMsQ0FBQyxZQUFZLENBQUM7QUFDbEQsTUFBSSxVQUFVLEdBQUcsT0FBTyxDQUFDLGFBQWEsQ0FBQyxDQUFDOzs7Ozs7OztBQVF4QyxNQUFJLGtCQUFrQixHQUFHOzs7Ozs7O0FBT3JCLGdCQUFZLEVBQUUsU0FBUyxZQUFZLENBQUMsS0FBSyxFQUFFO0FBQ3ZDLE9BQUMsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLFlBQVc7QUFDbkIsY0FBTSxDQUFDLEtBQUssQ0FBQyxLQUFLLElBQUksQ0FBQyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLEVBQUUsc0VBQXNFLENBQUMsQ0FBQztBQUN0SCxjQUFNLENBQUMsS0FBSyxDQUFDLE1BQU0sSUFBSSxDQUFDLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsRUFBRSx1RUFBdUUsQ0FBQyxDQUFDO0FBQ3pILGNBQU0sQ0FBQyxLQUFLLENBQUMsT0FBTyxJQUFJ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QUFrQixDQUFDLE9BQU8sQ0FBQyxTQUFTLEVBQUUsa0JBQWtCLENBQUMsa0JBQWtCLENBQUMsQ0FBQzs7QUFFdEYsU0FBTyxrQkFBa0IsQ0FBQztDQUM3QixDQUFDIiwiZmlsZSI6ImluZGV4LmpzIiwic291cmNlc0NvbnRlbnQiOlsicmVxdWlyZSgnNnRvNS9wb2x5ZmlsbCcpO1xudmFyIFByb21pc2UgPSByZXF1aXJlKCdibHVlYmlyZCcpO1xubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihSKSB7XHJcbiAgICB2YXIgaW8gPSByZXF1aXJlKFwic29ja2V0LmlvXCIpO1xyXG4gICAgdmFyIF8gPSByZXF1aXJlKFwibG9kYXNoXCIpO1xyXG4gICAgdmFyIGFzc2VydCA9IHJlcXVpcmUoXCJhc3NlcnRcIik7XHJcbiAgICB2YXIgY28gPSByZXF1aXJlKFwiY29cIik7XHJcbiAgICB2YXIgRXZlbnRFbWl0dGVyID0gcmVxdWlyZShcImV2ZW50c1wiKS5FdmVudEVtaXR0ZXI7XHJcbiAgICB2YXIgYm9keVBhcnNlciA9IHJlcXVpcmUoXCJib2R5LXBhcnNlclwiKTtcclxuXHJcbiAgICAvKipcclxuICAgICogPHA+IFNpbXBsZVVwbGlua1NlcnZlciByZXByZXNlbnRzIGFuIHVwbGluay1zZXJ2ZXIgdGhhdCB3aWxsIGJlIGFibGUgdG8gc3RvcmUgZGF0YSB2aWEgYW4gb3RoZXIgc2VydmVyLjxiciAvPlxyXG4gICAgKiBUaGVyZSBhbHNvIHdpbGwgYmUgYWJsZSB0byBub3RpZnkgZWFjaCBjbGllbnQgd2hvIHN1c2NyaWJlcyB0byBhIGRhdGEgd2hlbiBhbiB1cGRhdGUgd2lsbCBvY2N1cnMgdGhhbmtzIHRvIHNvY2tldCA8L3A+XHJcbiAgICAqIDxwPiBTaW1wbGVVcGxpbmtTZXJ2ZXIgd2lsbCBiZSByZXF1ZXN0ZWQgYnkgR0VUIG9yIFBPU1QgdmlhIFIuVXBsaW5rIHNlcnZlci1zaWRlIGFuZCBjbGllbnQtc2lkZVxyXG4gICAgKiBAY2xhc3MgUi5TaW1wbGVVcGxpbmtTZXJ2ZXJcclxuICAgICovXHJcbiAgICB2YXIgU2ltcGxlVXBsaW5rU2VydmVyID0ge1xyXG4gICAgICAgIC8qKlxyXG4gICAgICAgICogPHA+IEluaXRpYWxpemVzIHRoZSBTaW1wbGVVcGxpbmtTZXJ2ZXIgYWNjb3JkaW5nIHRvIHRoZSBzcGVjaWZpY2F0aW9ucyBwcm92aWRlZCA8L3A+XHJcbiAgICAgICAgKiBAbWV0aG9kIGNyZWF0ZUFwcFxyXG4gICAgICAgICogQHBhcmFtIHtvYmplY3R9IHNwZWNzIEFsbCB0aGUgc3BlY2lmaWNhdGlvbnMgb2YgdGhlIFNpbXBsZVVwbGlua1NlcnZlclxyXG4gICAgICAgICogQHJldHVybiB7U2ltcGxlVXBsaW5rU2VydmVySW5zdGFuY2V9IFNpbXBsZVVwbGlua1NlcnZlckluc3RhbmNlIFRoZSBpbnN0YW5jZSBvZiB0aGUgY3JlYXRlZCBTaW1wbGVVcGxpbmtTZXJ2ZXJcclxuICAgICAgICAqL1xyXG4gICAgICAgIGNyZWF0ZVNlcnZlcjogZnVuY3Rpb24gY3JlYXRlU2VydmVyKHNwZWNzKSB7XHJcbiAgICAgICAgICAgIFIuRGVidWcuZGV2KGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICAgICAgYXNzZXJ0KHNwZWNzLnN0b3JlICYmIF8uaXNBcnJheShzcGVjcy5zdG9yZSksIFwiUi5TaW1wbGVVcGxpbmtTZXJ2ZXIuY3JlYXRlU2VydmVyKC4uLikuc3BlY3Muc3RvcmU6IGV4cGVjdGluZyBBcnJheS5cIik7XHJcbiAgICAgICAgICAgICAgICBhc3NlcnQoc3BlY3MuZXZlbnRzICYmIF8uaXNBcnJheShzcGVjcy5ldmVudHMpLCBcIlIuU2ltcGxlVXBsaW5rU2VydmVyLmNyZWF0ZVNlcnZlciguLi4pLnNwZWNzLmV2ZW50czogZXhwZWN0aW5nIEFycmF5LlwiKTtcclxuICAgICAgICAgICAgICAgIGFzc2VydChzcGVjcy5hY3Rpb25zICYmIF8uaXNQbGFpbk9iamVjdChzcGVjcy5hY3Rpb25zKSwgXCJSLlNpbXBsZVVwbGlua1NlcnZlci5jcmVhdGVTZXJ2ZXIoLi4uKS5zcGVjcy5hY3Rpb25zOiBleHBlY3RpbmcgT2JqZWN0LlwiKTtcclxuICAgICAgICAgICAgICAgIGFzc2VydChzcGVjcy5zZXNzaW9uQ3JlYXRlZCAmJiBfLmlzRnVuY3Rpb24oc3BlY3Muc2Vzc2lvbkNyZWF0ZWQpLCBcIlIuU2ltcGxlVXBsaW5rU2VydmVyLmNyZWF0ZVNlcnZlciguLi4pLnNwZWNzLnNlc3Npb25DcmVhdGVkOiBleHBlY3RpbmcgRnVuY3Rpb24uXCIpO1xyXG4gICAgICAgICAgICAgICAgYXNzZXJ0KHNwZWNzLnNlc3Npb25EZXN0cm95ZWQgJiYgXy5pc0Z1bmN0aW9uKHNwZWNzLnNlc3Npb25EZXN0cm95ZWQpLCBcIlIuU2ltcGxlVXBsaW5rU2VydmVyLmNyZWF0ZVNlcnZlciguLi4pLnNwZWNzLnNlc3Npb25EZXN0cm95ZWQ6IGV4cGVjdGluZyBGdW5jdGlvbi5cIik7XHJcbiAgICAgICAgICAgICAgICBhc3NlcnQoc3BlY3Muc2Vzc2lvblRpbWVvdXQgJiYgXy5pc051bWJlcihzcGVjcy5zZXNzaW9uVGltZW91dCksIFwiUi5TaW1wbGVVcGxpbmtTZXJ2ZXIuY3JlYXRlU2VydmVyKC4uLikuc3BlY3Muc2Vzc2lvblRpbWVvdXQ6IGV4cGVjdGluZyBOdW1iZXIuXCIpO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgdmFyIFNpbXBsZVVwbGlua1NlcnZlckluc3RhbmNlID0gZnVuY3Rpb24gU2ltcGxlVXBsaW5rU2VydmVySW5zdGFuY2UoKSB7XHJcbiAgICAgICAgICAgICAgICBTaW1wbGVVcGxpbmtTZXJ2ZXIuU2ltcGxlVXBsaW5rU2VydmVySW5zdGFuY2UuY2FsbCh0aGlzKTtcclxuICAgICAgICAgICAgICAgIHRoaXMuX3NwZWNzID0gc3BlY3M7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9waWQgPSBSLmd1aWQoXCJTaW1wbGVVcGxpbmtTZXJ2ZXJcIik7XHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgIF8uZXh0ZW5kKFNpbXBsZVVwbGlua1NlcnZlckluc3RhbmNlLnByb3RvdHlwZSwgU2ltcGxlVXBsaW5rU2VydmVyLlNpbXBsZVVwbGlua1NlcnZlckluc3RhbmNlLnByb3RvdHlwZSwgc3BlY3MpO1xyXG4gICAgICAgICAgICByZXR1cm4gU2ltcGxlVXBsaW5rU2VydmVySW5zdGFuY2U7XHJcbiAgICAgICAgfSxcclxuICAgICAgICAvKipcclxuICAgICAgICAqIDxwPiBTZXR0aW5nIHVwIG5lY2Vzc2FyeSBtZXRob2RzIGZvciB0aGUgU2ltcGxlVXBsaW5rU2VydmVyIDwvcD5cclxuICAgICAgICAqIEBtZXRob2QgU2ltcGxlVXBsaW5rU2VydmVySW5zdGFuY2VcclxuICAgICAgICAqL1xyXG4gICAgICAgIFNpbXBsZVVwbGlua1NlcnZlckluc3RhbmNlOiBmdW5jdGlvbiBTaW1wbGVVcGxpbmtTZXJ2ZXJJbnN0YW5jZSgpIHtcclxuICAgICAgICAgICAgdGhpcy5fc3RvcmUgPSB7fTtcclxuICAgICAgICAgICAgdGhpcy5faGFzaGVzID0ge307XHJcbiAgICAgICAgICAgIHRoaXMuX3N0b3JlUm91dGVyID0gbmV3IFIuUm91dGVyKCk7XHJcbiAgICAgICAgICAgIHRoaXMuX3N0b3JlUm91dGVyLmRlZihfLmNvbnN0YW50KHtcclxuICAgICAgICAgICAgICAgIGVycjogXCJVbmtub3duIHN0b3JlIGtleVwiLFxyXG4gICAgICAgICAgICB9KSk7XHJcbiAgICAgICAgICAgIHRoaXMuX3N0b3JlRXZlbnRzID0gbmV3IEV2ZW50RW1pdHRlcigpO1xyXG4gICAgICAgICAgICB0aGlzLl9ldmVudHNSb3V0ZXIgPSBuZXcgUi5Sb3V0ZXIoKTtcclxuICAgICAgICAgICAgdGhpcy5fZXZlbnRzUm91dGVyLmRlZihfLmNvbnN0YW50KHtcclxuICAgICAgICAgICAgICAgIGVycjogXCJVbmtub3duIGV2ZW50IG5hbWVcIixcclxuICAgICAgICAgICAgfSkpO1xyXG4gICAgICAgICAgICB0aGlzLl9ldmVudHNFdmVudHMgPSBuZXcgRXZlbnRFbWl0dGVyKCk7XHJcbiAgICAgICAgICAgIHRoaXMuX2FjdGlvbnNSb3V0ZXIgPSBuZXcgUi5Sb3V0ZXIoKTtcclxuICAgICAgICAgICAgdGhpcy5fYWN0aW9uc1JvdXRlci5kZWYoXy5jb25zdGFudCh7XHJcbiAgICAgICAgICAgICAgICBlcnI6IFwiVW5rbm93biBhY3Rpb25cIixcclxuICAgICAgICAgICAgfSkpO1xyXG4gICAgICAgICAgICB0aGlzLl9zZXNzaW9ucyA9IHt9O1xyXG4gICAgICAgICAgICB0aGlzLl9zZXNzaW9uc0V2ZW50cyA9IG5ldyBFdmVudEVtaXR0ZXIoKTtcclxuICAgICAgICAgICAgdGhpcy5fY29ubmVjdGlvbnMgPSB7fTtcclxuXHJcbiAgICAgICAgICAgIHRoaXMuX2xpbmtTZXNzaW9uID0gUi5zY29wZSh0aGlzLl9saW5rU2Vzc2lvbiwgdGhpcyk7XHJcbiAgICAgICAgICAgIHRoaXMuX3VubGlua1Nlc3Npb24gPSBSLnNjb3BlKHRoaXMuX3VubGlua1Nlc3Npb24sIHRoaXMpO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgX1NpbXBsZVVwbGlua1NlcnZlckluc3RhbmNlUHJvdG9Qcm9wczogLyoqIEBsZW5kcyBSLlNpbXBsZVVwbGlua1NlcnZlci5TaW1wbGVVcGxpbmtTZXJ2ZXJJbnN0YW5jZS5wcm90b3R5cGUgKi97XHJcbiAgICAgICAgICAgIF9zcGVjczogbnVsbCxcclxuICAgICAgICAgICAgX3BpZDogbnVsbCxcclxuICAgICAgICAgICAgX3ByZWZpeDogbnVsbCxcclxuICAgICAgICAgICAgX2FwcDogbnVsbCxcclxuICAgICAgICAgICAgX2lvOiBudWxsLFxyXG4gICAgICAgICAgICBfc3RvcmU6IG51bGwsXHJcbiAgICAgICAgICAgIF9zdG9yZUV2ZW50czogbnVsbCxcclxuICAgICAgICAgICAgX3N0b3JlUm91dGVyOiBudWxsLFxyXG4gICAgICAgICAgICBfZXZlbnRzUm91dGVyOiBudWxsLFxyXG4gICAgICAgICAgICBfZXZlbnRzRXZlbnRzOiBudWxsLFxyXG4gICAgICAgICAgICBfYWN0aW9uc1JvdXRlcjogbnVsbCxcclxuICAgICAgICAgICAgX3Nlc3Npb25zOiBudWxsLFxyXG4gICAgICAgICAgICBfc2Vzc2lvbnNFdmVudHM6IG51bGwsXHJcbiAgICAgICAgICAgIF9jb25uZWN0aW9uczogbnVsbCxcclxuICAgICAgICAgICAgYm9vdHN0cmFwOiBudWxsLFxyXG4gICAgICAgICAgICBzZXNzaW9uQ3JlYXRlZDogbnVsbCxcclxuICAgICAgICAgICAgc2Vzc2lvbkRlc3Ryb3llZDogbnVsbCxcclxuICAgICAgICAgICAgc2Vzc2lvblRpbWVvdXQ6IG51bGwsXHJcbiAgICAgICAgICAgIC8qKlxyXG4gICAgICAgICAgICAqIDxwPlNhdmVzIGRhdGEgaW4gc3RvcmUuXHJcbiAgICAgICAgICAgICogQ2FsbGVkIGJ5IGFub3RoZXIgc2VydmVyIHRoYXQgd2lsbCBwcm92aWRlIGRhdGEgZm9yIGVhY2ggdXBkYXRlZCBkYXRhIDwvcD5cclxuICAgICAgICAgICAgKiBAbWV0aG9kIHNldFN0b3JlXHJcbiAgICAgICAgICAgICogQHBhcmFtIHtzdHJpbmd9IGtleSBUaGUgc3BlY2lmaWVkIGtleSB0byBzZXRcclxuICAgICAgICAgICAgKiBAcGFyYW0ge3N0cmluZ30gdmFsIFRoZSB2YWx1ZSB0byBzYXZlXHJcbiAgICAgICAgICAgICogQHJldHVybiB7ZnVuY3Rpb259IFxyXG4gICAgICAgICAgICAqL1xyXG4gICAgICAgICAgICBzZXRTdG9yZTogZnVuY3Rpb24gc2V0U3RvcmUoa2V5LCB2YWwpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiBSLnNjb3BlKGZ1bmN0aW9uKGZuKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdmFyIHByZXZpb3VzVmFsID0gdGhpcy5fc3RvcmVba2V5XSB8fCB7fTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdmFyIHByZXZpb3VzSGFzaCA9IHRoaXMuX2hhc2hlc1trZXldIHx8IFIuaGFzaChKU09OLnN0cmluZ2lmeShwcmV2aW91c1ZhbCkpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB2YXIgZGlmZiA9IFIuZGlmZihwcmV2aW91c1ZhbCwgdmFsKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdmFyIGhhc2ggPSBSLmhhc2goSlNPTi5zdHJpbmdpZnkodmFsKSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX3N0b3JlW2tleV0gPSB2YWw7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX2hhc2hlc1trZXldID0gaGFzaDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5fc3RvcmVFdmVudHMuZW1pdChcInNldDpcIiArIGtleSwge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgazoga2V5LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZDogZGlmZixcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGg6IHByZXZpb3VzSGFzaCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIGNhdGNoKGVycikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZm4oUi5EZWJ1Zy5leHRlbmRFcnJvcihlcnIsIFwiUi5TaW1wbGVVcGxpbmtTZXJ2ZXIuc2V0U3RvcmUoJ1wiICsga2V5ICsgXCInLCAnXCIgKyB2YWwgKyBcIicpXCIpKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgXy5kZWZlcihmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZm4obnVsbCwgdmFsKTtcclxuICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgIH0sIHRoaXMpO1xyXG4gICAgICAgICAgICB9LFxyXG5cclxuICAgICAgICAgICAgLyoqXHJcbiAgICAgICAgICAgICogPHA+IFByb3ZpZGVzIGRhdGEgZnJvbSBzdG9yZS4gPGJyIC8+XHJcbiAgICAgICAgICAgICogQ2FsbGVkIHdoZW4gdGhlIGZldGNoaW5nIGRhdGEgb2NjdXJzLiA8YnIgLz5cclxuICAgICAgICAgICAgKiBSZXF1ZXN0ZWQgYnkgR0VUIGZyb20gUi5TdG9yZSBzZXJ2ZXItc2lkZSBvciBjbGllbnQtc2lkZTwvcD5cclxuICAgICAgICAgICAgKiBAbWV0aG9kIGdldFN0b3JlXHJcbiAgICAgICAgICAgICogQHBhcmFtIHtzdHJpbmd9IGtleSBUaGUgc3BlY2lmaWVkIGtleSB0byBzZXRcclxuICAgICAgICAgICAgKiBAcmV0dXJuIHtmdW5jdGlvbn0gXHJcbiAgICAgICAgICAgICovXHJcbiAgICAgICAgICAgIGdldFN0b3JlOiBmdW5jdGlvbiBnZXRTdG9yZShrZXkpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiBSLnNjb3BlKGZ1bmN0aW9uKGZuKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdmFyIHZhbDtcclxuICAgICAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBSLkRlYnVnLmRldihSLnNjb3BlKGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYoIV8uaGFzKHRoaXMuX3N0b3JlLCBrZXkpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS53YXJuKFwiUi5TaW1wbGVVcGxpbmtTZXJ2ZXIoLi4uKS5nZXRTdG9yZTogbm8gc3VjaCBrZXkgKFwiICsga2V5ICsgXCIpXCIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9LCB0aGlzKSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhbCA9IHRoaXMuX3N0b3JlW2tleV07XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIGNhdGNoKGVycikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZm4oUi5EZWJ1Zy5leHRlbmRFcnJvcihlcnIsIFwiUi5TaW1wbGVVcGxpbmtTZXJ2ZXIuZ2V0U3RvcmUoJ1wiICsga2V5ICsgXCInKVwiKSk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIF8uZGVmZXIoZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGZuKG51bGwsIHZhbCk7XHJcbiAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICB9LCB0aGlzKTtcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgLyoqXHJcbiAgICAgICAgICAgICogQG1ldGhvZCBlbWl0RXZlbnRcclxuICAgICAgICAgICAgKiBAcGFyYW0ge3N0cmluZ30gZXZlbnROYW1lXHJcbiAgICAgICAgICAgICogQHBhcmFtIHtvYmplY3R9IHBhcmFtc1xyXG4gICAgICAgICAgICAqL1xyXG4gICAgICAgICAgICBlbWl0RXZlbnQ6IGZ1bmN0aW9uIGVtaXRFdmVudChldmVudE5hbWUsIHBhcmFtcykge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fZXZlbnRzRXZlbnRzLmVtaXQoXCJlbWl0OlwiICsgZXZlbnROYW1lLCBwYXJhbXMpO1xyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAvKipcclxuICAgICAgICAgICAgKiBAbWV0aG9kIGVtaXREZWJ1Z1xyXG4gICAgICAgICAgICAqIEBwYXJhbSB7c3RyaW5nfSBndWlkXHJcbiAgICAgICAgICAgICogQHBhcmFtIHtvYmplY3R9IHBhcmFtc1xyXG4gICAgICAgICAgICAqL1xyXG4gICAgICAgICAgICBlbWl0RGVidWc6IGZ1bmN0aW9uIGVtaXREZWJ1ZyhndWlkLCBwYXJhbXMpIHtcclxuICAgICAgICAgICAgICAgIFIuRGVidWcuZGV2KFIuc2NvcGUoZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYodGhpcy5fc2Vzc2lvbnNbZ3VpZF0pIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2Vzc2lvbnNbZ3VpZF0uZW1pdChcImRlYnVnXCIsIHBhcmFtcyk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSwgdGhpcykpO1xyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAvKipcclxuICAgICAgICAgICAgKiBAbWV0aG9kIGVtaXRMb2dcclxuICAgICAgICAgICAgKiBAcGFyYW0ge3N0cmluZ30gZ3VpZFxyXG4gICAgICAgICAgICAqIEBwYXJhbSB7b2JqZWN0fSBwYXJhbXNcclxuICAgICAgICAgICAgKi9cclxuICAgICAgICAgICAgZW1pdExvZzogZnVuY3Rpb24gZW1pdExvZyhndWlkLCBwYXJhbXMpIHtcclxuICAgICAgICAgICAgICAgIGlmKHRoaXMuX3Nlc3Npb25zW2d1aWRdKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2Vzc2lvbnNbZ3VpZF0uZW1pdChcImxvZ1wiLCBwYXJhbXMpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAvKipcclxuICAgICAgICAgICAgKiBAbWV0aG9kIGVtaXRXYXJuXHJcbiAgICAgICAgICAgICogQHBhcmFtIHtzdHJpbmd9IGd1aWRcclxuICAgICAgICAgICAgKiBAcGFyYW0ge29iamVjdH0gcGFyYW1zXHJcbiAgICAgICAgICAgICovXHJcbiAgICAgICAgICAgIGVtaXRXYXJuOiBmdW5jdGlvbiBlbWl0TG9nKGd1aWQsIHBhcmFtcykge1xyXG4gICAgICAgICAgICAgICAgaWYodGhpcy5fc2Vzc2lvbnNbZ3VpZF0pIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLl9zZXNzaW9uc1tndWlkXS5lbWl0KFwid2FyblwiLCBwYXJhbXMpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAvKipcclxuICAgICAgICAgICAgKiBAbWV0aG9kIGVtaXRFcnJvclxyXG4gICAgICAgICAgICAqIEBwYXJhbSB7c3RyaW5nfSBndWlkXHJcbiAgICAgICAgICAgICogQHBhcmFtIHtvYmplY3R9IHBhcmFtc1xyXG4gICAgICAgICAgICAqLyAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBlbWl0RXJyb3I6IGZ1bmN0aW9uIGVtaXRMb2coZ3VpZCwgcGFyYW1zKSB7XHJcbiAgICAgICAgICAgICAgICBpZih0aGlzLl9zZXNzaW9uc1tndWlkXSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3Nlc3Npb25zW2d1aWRdLmVtaXQoXCJlcnJcIiwgcGFyYW1zKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgX2V4dHJhY3RPcmlnaW5hbFBhdGg6IGZ1bmN0aW9uIF9leHRyYWN0T3JpZ2luYWxQYXRoKCkge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIGFyZ3VtZW50c1thcmd1bWVudHMubGVuZ3RoIC0gMV07XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIF9iaW5kU3RvcmVSb3V0ZTogZnVuY3Rpb24gX2JpbmRTdG9yZVJvdXRlKHJvdXRlKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9zdG9yZVJvdXRlci5yb3V0ZShyb3V0ZSwgdGhpcy5fZXh0cmFjdE9yaWdpbmFsUGF0aCk7XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIF9iaW5kRXZlbnRzUm91dGU6IGZ1bmN0aW9uIF9iaW5kRXZlbnRzUm91dGUocm91dGUpIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuX2V2ZW50c1JvdXRlci5yb3V0ZShyb3V0ZSwgdGhpcy5fZXh0cmFjdE9yaWdpbmFsUGF0aCk7XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIF9iaW5kQWN0aW9uc1JvdXRlOiBmdW5jdGlvbiBfYmluZEFjdGlvbnNSb3V0ZShoYW5kbGVyLCByb3V0ZSkge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fYWN0aW9uc1JvdXRlci5yb3V0ZShyb3V0ZSwgXy5jb25zdGFudChSLnNjb3BlKGhhbmRsZXIsIHRoaXMpKSk7XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIC8qKiBcclxuICAgICAgICAgICAgKiA8cD4gU2V0dGluZyB1cCBVcGxpbmtTZXJ2ZXIuIDxiciAvPlxyXG4gICAgICAgICAgICAqIC0gY3JlYXRlIHRoZSBzb2NrZXQgY29ubmVjdGlvbiA8YnIgLz5cclxuICAgICAgICAgICAgKiAtIGluaXQgZ2V0IGFuZCBwb3N0IGFwcCBpbiBvcmRlciB0byBwcm92aWRlIGRhdGEgdmlhIFIuVXBsaW5rLmZldGNoPC9wPlxyXG4gICAgICAgICAgICAqIEBtZXRob2QgaW5zdGFsbEhhbmRsZXJzXHJcbiAgICAgICAgICAgICogQHBhcmFtIHtvYmplY3R9IGFwcCBUaGUgc3BlY2lmaWVkIEFwcFxyXG4gICAgICAgICAgICAqIEBwYXJhbSB7c3RyaW5nfSBwcmVmaXggVGhlIHByZWZpeCBzdHJpbmcgdGhhdCB3aWxsIGJlIHJlcXVlc3RlZC4gVGlwaWNhbGx5IFwiL3VwbGlua1wiXHJcbiAgICAgICAgICAgICovXHJcbiAgICAgICAgICAgIGluc3RhbGxIYW5kbGVyczogZnVuY3Rpb24qIGluc3RhbGxIYW5kbGVycyhhcHAsIHByZWZpeCkge1xyXG4gICAgICAgICAgICAgICAgYXNzZXJ0KHRoaXMuX2FwcCA9PT0gbnVsbCwgXCJSLlNpbXBsZVVwbGlua1NlcnZlci5TaW1wbGVVcGxpbmtTZXJ2ZXJJbnN0YW5jZS5pbnN0YWxsSGFuZGxlcnMoLi4uKTogYXBwIGFscmVhZHkgbW91bnRlZC5cIik7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9hcHAgPSBhcHA7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9wcmVmaXggPSBwcmVmaXggfHwgXCIvdXBsaW5rL1wiO1xyXG4gICAgICAgICAgICAgICAgdmFyIHNlcnZlciA9IHJlcXVpcmUoXCJodHRwXCIpLlNlcnZlcihhcHApO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5faW8gPSBpbyhzZXJ2ZXIpLm9mKHByZWZpeCk7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9hcHAuZ2V0KHRoaXMuX3ByZWZpeCArIFwiKlwiLCBSLnNjb3BlKHRoaXMuX2hhbmRsZUh0dHBHZXQsIHRoaXMpKTtcclxuICAgICAgICAgICAgICAgIHRoaXMuX2FwcC5wb3N0KHRoaXMuX3ByZWZpeCArIFwiKlwiLCBib2R5UGFyc2VyLmpzb24oKSwgUi5zY29wZSh0aGlzLl9oYW5kbGVIdHRwUG9zdCwgdGhpcykpO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5faW8ub24oXCJjb25uZWN0aW9uXCIsIFIuc2NvcGUodGhpcy5faGFuZGxlU29ja2V0Q29ubmVjdGlvbiwgdGhpcykpO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5faGFuZGxlU29ja2V0RGlzY29ubmVjdGlvbiA9IFIuc2NvcGUodGhpcy5faGFuZGxlU29ja2V0RGlzY29ubmVjdGlvbiwgdGhpcyk7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9zZXNzaW9uc0V2ZW50cy5hZGRMaXN0ZW5lcihcImV4cGlyZVwiLCBSLnNjb3BlKHRoaXMuX2hhbmRsZVNlc3Npb25FeHBpcmUsIHRoaXMpKTtcclxuICAgICAgICAgICAgICAgIF8uZWFjaCh0aGlzLl9zcGVjcy5zdG9yZSwgUi5zY29wZSh0aGlzLl9iaW5kU3RvcmVSb3V0ZSwgdGhpcykpO1xyXG4gICAgICAgICAgICAgICAgXy5lYWNoKHRoaXMuX3NwZWNzLmV2ZW50cywgUi5zY29wZSh0aGlzLl9iaW5kRXZlbnRzUm91dGUsIHRoaXMpKTtcclxuICAgICAgICAgICAgICAgIF8uZWFjaCh0aGlzLl9zcGVjcy5hY3Rpb25zLCBSLnNjb3BlKHRoaXMuX2JpbmRBY3Rpb25zUm91dGUsIHRoaXMpKTtcclxuICAgICAgICAgICAgICAgIHRoaXMuYm9vdHN0cmFwID0gUi5zY29wZSh0aGlzLl9zcGVjcy5ib290c3RyYXAsIHRoaXMpO1xyXG4gICAgICAgICAgICAgICAgeWllbGQgdGhpcy5ib290c3RyYXAoKTtcclxuICAgICAgICAgICAgICAgIHJldHVybiBzZXJ2ZXI7XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIC8qKlxyXG4gICAgICAgICAgICAqIDxwPlJldHVybiB0aGUgc2F2ZWQgZGF0YSBmcm9tIHN0b3JlPC9wPlxyXG4gICAgICAgICAgICAqIDxwPlJlcXVlc3RlZCBmcm9tIFIuU3RvcmUgc2VydmVyLXNpZGUgb3IgY2xpZW50LXNpZGU8L3A+XHJcbiAgICAgICAgICAgICogQG1ldGhvZCBfaGFuZGxlSHR0cEdldFxyXG4gICAgICAgICAgICAqIEBwYXJhbSB7b2JqZWN0fSByZXEgVGhlIGNsYXNzaWNhbCByZXF1ZXN0XHJcbiAgICAgICAgICAgICogQHBhcmFtIHtvYmplY3R9IHJlcyBUaGUgcmVzcG9uc2UgdG8gc2VuZFxyXG4gICAgICAgICAgICAqIEBwYXJhbSB7b2JqZWN0fSBuZXh0XHJcbiAgICAgICAgICAgICogQHJldHVybiB7c3RyaW5nfSB2YWwgVGhlIGNvbXB1dGVkIGpzb24gdmFsdWVcclxuICAgICAgICAgICAgKi9cclxuICAgICAgICAgICAgX2hhbmRsZUh0dHBHZXQ6IGZ1bmN0aW9uIF9oYW5kbGVIdHRwR2V0KHJlcSwgcmVzLCBuZXh0KSB7XHJcbiAgICAgICAgICAgICAgICBjbyhmdW5jdGlvbiooKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdmFyIHBhdGggPSByZXEucGF0aC5zbGljZSh0aGlzLl9wcmVmaXgubGVuZ3RoIC0gMSk7IC8vIGtlZXAgdGhlIGxlYWRpbmcgc2xhc2hcclxuICAgICAgICAgICAgICAgICAgICB2YXIga2V5ID0gdGhpcy5fc3RvcmVSb3V0ZXIubWF0Y2gocGF0aCk7XHJcbiAgICAgICAgICAgICAgICAgICAgUi5EZWJ1Zy5kZXYoZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUud2FybihcIjw8PCBmZXRjaFwiLCBwYXRoKTtcclxuICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4geWllbGQgdGhpcy5nZXRTdG9yZShrZXkpO1xyXG4gICAgICAgICAgICAgICAgfSkuY2FsbCh0aGlzLCBmdW5jdGlvbihlcnIsIHZhbCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmKGVycikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZihSLkRlYnVnLmlzRGV2KCkpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiByZXMuc3RhdHVzKDUwMCkuanNvbih7IGVycjogZXJyLnRvU3RyaW5nKCksIHN0YWNrOiBlcnIuc3RhY2sgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gcmVzLnN0YXR1cyg1MDApLmpzb24oeyBlcnI6IGVyci50b1N0cmluZygpIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gcmVzLnN0YXR1cygyMDApLmpzb24odmFsKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgLyoqXHJcbiAgICAgICAgICAgICogQG1ldGhvZCBfaGFuZGxlSHR0cFBvc3RcclxuICAgICAgICAgICAgKiBAcGFyYW0ge29iamVjdH0gcmVxIFRoZSBjbGFzc2ljYWwgcmVxdWVzdFxyXG4gICAgICAgICAgICAqIEBwYXJhbSB7b2JqZWN0fSByZXMgVGhlIHJlc3BvbnNlIHRvIHNlbmRcclxuICAgICAgICAgICAgKiBAcmV0dXJuIHtzdHJpbmd9IHN0clxyXG4gICAgICAgICAgICAqL1xyXG4gICAgICAgICAgICBfaGFuZGxlSHR0cFBvc3Q6IGZ1bmN0aW9uIF9oYW5kbGVIdHRwUG9zdChyZXEsIHJlcykge1xyXG4gICAgICAgICAgICAgICAgY28oZnVuY3Rpb24qKCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHZhciBwYXRoID0gcmVxLnBhdGguc2xpY2UodGhpcy5fcHJlZml4Lmxlbmd0aCAtIDEpOyAvLyBrZWVwIHRoZSBsZWFkaW5nIHNsYXNoXHJcbiAgICAgICAgICAgICAgICAgICAgdmFyIGhhbmRsZXIgPSB0aGlzLl9hY3Rpb25zUm91dGVyLm1hdGNoKHBhdGgpO1xyXG4gICAgICAgICAgICAgICAgICAgIGFzc2VydChfLmlzT2JqZWN0KHJlcS5ib2R5KSwgXCJib2R5OiBleHBlY3RpbmcgT2JqZWN0LlwiKTtcclxuICAgICAgICAgICAgICAgICAgICBhc3NlcnQocmVxLmJvZHkuZ3VpZCAmJiBfLmlzU3RyaW5nKHJlcS5ib2R5Lmd1aWQpLCBcImd1aWQ6IGV4cGVjdGluZyBTdHJpbmcuXCIpO1xyXG4gICAgICAgICAgICAgICAgICAgIGFzc2VydChyZXEuYm9keS5wYXJhbXMgJiYgXy5pc1BsYWluT2JqZWN0KHJlcS5ib2R5LnBhcmFtcyksIFwicGFyYW1zOiBleHBlY3RpbmcgT2JqZWN0LlwiKTtcclxuICAgICAgICAgICAgICAgICAgICBpZighXy5oYXModGhpcy5fc2Vzc2lvbnMsIHJlcS5ib2R5Lmd1aWQpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX3Nlc3Npb25zW2d1aWRdID0gbmV3IFIuU2ltcGxlVXBsaW5rU2VydmVyLlNlc3Npb24oZ3VpZCwgdGhpcy5fc3RvcmVFdmVudHMsIHRoaXMuX2V2ZW50c0V2ZW50cywgdGhpcy5fc2Vzc2lvbnNFdmVudHMsIHRoaXMuc2Vzc2lvblRpbWVvdXQpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB5aWVsZCB0aGlzLnNlc3Npb25DcmVhdGVkKGd1aWQpO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB2YXIgcGFyYW1zID0gXy5leHRlbmQoe30sIHsgZ3VpZDogcmVxLmJvZHkuZ3VpZCB9LCByZXEuYm9keS5wYXJhbXMpO1xyXG4gICAgICAgICAgICAgICAgICAgIFIuRGVidWcuZGV2KGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oXCI8PDwgYWN0aW9uXCIsIHBhdGgsIHBhcmFtcyk7XHJcbiAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHlpZWxkIGhhbmRsZXIocGFyYW1zKTtcclxuICAgICAgICAgICAgICAgIH0pLmNhbGwodGhpcywgZnVuY3Rpb24oZXJyLCB2YWwpIHtcclxuICAgICAgICAgICAgICAgICAgICBpZihlcnIpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYoUi5EZWJ1Zy5pc0RldigpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gcmVzLnN0YXR1cyg1MDApLmpzb24oeyBlcnI6IGVyci50b1N0cmluZygpLCBzdGFjazogZXJyLnN0YWNrIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoNTAwKS5qc29uKHsgZXJyOiBlcnIudG9TdHJpbmcoKSB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmVzLnN0YXR1cygyMDApLmpzb24odmFsKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgLyoqIFxyXG4gICAgICAgICAgICAqIDxwPiBDcmVhdGUgYSBSLlNpbXBsZVVwbGlua1NlcnZlci5Db25uZWN0aW9uIGluIG9yZGVyIHRvIHNldCB1cCBoYW5kbGVyIGl0ZW1zLiA8YnIgLz5cclxuICAgICAgICAgICAgKiBUcmlnZ2VyZWQgd2hlbiBhIHNvY2tldCBjb25uZWN0aW9uIGlzIGVzdGFibGlzaGVkIDwvcD5cclxuICAgICAgICAgICAgKiBAbWV0aG9kIF9oYW5kbGVTb2NrZXRDb25uZWN0aW9uXHJcbiAgICAgICAgICAgICogQHBhcmFtIHtPYmplY3R9IHNvY2tldCBUaGUgc29ja2V0IHVzZWQgaW4gdGhlIGNvbm5lY3Rpb25cclxuICAgICAgICAgICAgKi9cclxuICAgICAgICAgICAgX2hhbmRsZVNvY2tldENvbm5lY3Rpb246IGZ1bmN0aW9uIF9oYW5kbGVTb2NrZXRDb25uZWN0aW9uKHNvY2tldCkge1xyXG4gICAgICAgICAgICAgICAgdmFyIGNvbm5lY3Rpb24gPSBuZXcgUi5TaW1wbGVVcGxpbmtTZXJ2ZXIuQ29ubmVjdGlvbih0aGlzLl9waWQsIHNvY2tldCwgdGhpcy5faGFuZGxlU29ja2V0RGlzY29ubmVjdGlvbiwgdGhpcy5fbGlua1Nlc3Npb24sIHRoaXMuX3VubGlua1Nlc3Npb24pO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fY29ubmVjdGlvbnNbY29ubmVjdGlvbi51bmlxdWVJZF0gPSBjb25uZWN0aW9uO1xyXG4gICAgICAgICAgICB9LFxyXG5cclxuICAgICAgICAgICAgLyoqIFxyXG4gICAgICAgICAgICAqIDxwPiBEZXN0cm95IGEgUi5TaW1wbGVVcGxpbmtTZXJ2ZXIuQ29ubmVjdGlvbi4gPGJyIC8+XHJcbiAgICAgICAgICAgICogVHJpZ2dlcmVkIHdoZW4gYSBzb2NrZXQgY29ubmVjdGlvbiBpcyBjbG9zZWQgPC9wPlxyXG4gICAgICAgICAgICAqIEBtZXRob2QgX2hhbmRsZVNvY2tldERpc2Nvbm5lY3Rpb25cclxuICAgICAgICAgICAgKiBAcGFyYW0ge3N0cmluZ30gdW5pcXVlSWQgVGhlIHVuaXF1ZSBJZCBvZiB0aGUgY29ubmVjdGlvblxyXG4gICAgICAgICAgICAqL1xyXG4gICAgICAgICAgICBfaGFuZGxlU29ja2V0RGlzY29ubmVjdGlvbjogZnVuY3Rpb24gX2hhbmRsZVNvY2tldERpc2Nvbm5lY3Rpb24odW5pcXVlSWQpIHtcclxuICAgICAgICAgICAgICAgIHZhciBndWlkID0gdGhpcy5fY29ubmVjdGlvbnNbdW5pcXVlSWRdLmd1aWQ7XHJcbiAgICAgICAgICAgICAgICBpZihndWlkICYmIHRoaXMuX3Nlc3Npb25zW2d1aWRdKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2Vzc2lvbnNbZ3VpZF0uZGV0YWNoQ29ubmVjdGlvbigpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgZGVsZXRlIHRoaXMuX2Nvbm5lY3Rpb25zW3VuaXF1ZUlkXTtcclxuICAgICAgICAgICAgfSxcclxuXHJcbiAgICAgICAgICAgIC8qKiBcclxuICAgICAgICAgICAgKiA8cD5MaW5rIGEgU2Vzc2lvbiBpbiBvcmRlciB0byBzZXQgdXAgc3Vic2NyaWJpbmcgYW5kIHVuc3Vic2NyaWJpbmcgbWV0aG9kcyB1cGxpbmstc2VydmVyLXNpZGU8L3A+XHJcbiAgICAgICAgICAgICogQG1ldGhvZCBfbGlua1Nlc3Npb25cclxuICAgICAgICAgICAgKiBAcGFyYW0ge1NpbXBsZVVwbGlua1NlcnZlci5Db25uZWN0aW9ufSBjb25uZWN0aW9uIFRoZSBjcmVhdGVkIGNvbm5lY3Rpb25cclxuICAgICAgICAgICAgKiBAcGFyYW0ge3N0cmluZ30gZ3VpZCBVbmlxdWUgc3RyaW5nIEdVSURcclxuICAgICAgICAgICAgKiBAcmV0dXJuIHtvYmplY3R9IHRoZSBvYmplY3QgdGhhdCBjb250YWlucyBtZXRob2RzIHN1YnNjcmlwdGlvbnMvdW5zdWJzY3JpcHRpb25zXHJcbiAgICAgICAgICAgICovXHJcbiAgICAgICAgICAgIF9saW5rU2Vzc2lvbjogZnVuY3Rpb24qIF9saW5rU2Vzc2lvbihjb25uZWN0aW9uLCBndWlkKSB7XHJcbiAgICAgICAgICAgICAgICBpZighdGhpcy5fc2Vzc2lvbnNbZ3VpZF0pIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLl9zZXNzaW9uc1tndWlkXSA9IG5ldyBSLlNpbXBsZVVwbGlua1NlcnZlci5TZXNzaW9uKGd1aWQsIHRoaXMuX3N0b3JlRXZlbnRzLCB0aGlzLl9ldmVudHNFdmVudHMsIHRoaXMuX3Nlc3Npb25zRXZlbnRzLCB0aGlzLnNlc3Npb25UaW1lb3V0KTtcclxuICAgICAgICAgICAgICAgICAgICB5aWVsZCB0aGlzLnNlc3Npb25DcmVhdGVkKGd1aWQpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuX3Nlc3Npb25zW2d1aWRdLmF0dGFjaENvbm5lY3Rpb24oY29ubmVjdGlvbik7XHJcbiAgICAgICAgICAgIH0sXHJcblxyXG4gICAgICAgICAgICAvKiogXHJcbiAgICAgICAgICAgICogPHA+VW5saW5rIGEgU2Vzc2lvbjwvcD5cclxuICAgICAgICAgICAgKiBAbWV0aG9kIF91bmxpbmtTZXNzaW9uXHJcbiAgICAgICAgICAgICogQHBhcmFtIHtTaW1wbGVVcGxpbmtTZXJ2ZXIuQ29ubmVjdGlvbn0gY29ubmVjdGlvbiBcclxuICAgICAgICAgICAgKiBAcGFyYW0ge3N0cmluZ30gZ3VpZCBVbmlxdWUgc3RyaW5nIEdVSURcclxuICAgICAgICAgICAgKiBAcmV0dXJuIHtGdW5jdGlvbn0gZm5cclxuICAgICAgICAgICAgKi9cclxuICAgICAgICAgICAgX3VubGlua1Nlc3Npb246IGZ1bmN0aW9uIF91bmxpbmtTZXNzaW9uKGNvbm5lY3Rpb24sIGd1aWQpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiBSLnNjb3BlKGZ1bmN0aW9uKGZuKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYodGhpcy5fc2Vzc2lvbnNbZ3VpZF0pIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX3Nlc3Npb25zW2d1aWRdLnRlcm1pbmF0ZSgpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIGNhdGNoKGVycikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZm4oUi5EZWJ1Zy5leHRlbmRFcnJvcihcIlIuU2ltcGxlVXBsaW5rU2VydmVySW5zdGFuY2UuX3VubGlua1Nlc3Npb24oLi4uKVwiKSk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBmbihudWxsKTtcclxuICAgICAgICAgICAgICAgIH0sIHRoaXMpO1xyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAvKiogXHJcbiAgICAgICAgICAgICogQG1ldGhvZCBfaGFuZGxlU2Vzc2lvbkV4cGlyZVxyXG4gICAgICAgICAgICAqIEBwYXJhbSB7c3RyaW5nfSBndWlkIFVuaXF1ZSBzdHJpbmcgR1VJRFxyXG4gICAgICAgICAgICAqL1xyXG4gICAgICAgICAgICBfaGFuZGxlU2Vzc2lvbkV4cGlyZTogZnVuY3Rpb24gX2hhbmRsZVNlc3Npb25FeHBpcmUoZ3VpZCkge1xyXG4gICAgICAgICAgICAgICAgUi5EZWJ1Zy5kZXYoUi5zY29wZShmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgICAgICAgICBhc3NlcnQoXy5oYXModGhpcy5fc2Vzc2lvbnMsIGd1aWQpLCBcIlIuU2ltcGxlVXBsaW5rU2VydmVyLl9oYW5kbGVTZXNzaW9uRXhwaXJlKC4uLik6IG5vIHN1Y2ggc2Vzc2lvbi5cIik7XHJcbiAgICAgICAgICAgICAgICB9LCB0aGlzKSk7XHJcbiAgICAgICAgICAgICAgICBkZWxldGUgdGhpcy5fc2Vzc2lvbnNbZ3VpZF07XHJcbiAgICAgICAgICAgICAgICBjbyhmdW5jdGlvbiooKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgeWllbGQgdGhpcy5zZXNzaW9uRGVzdHJveWVkKGd1aWQpO1xyXG4gICAgICAgICAgICAgICAgfSkuY2FsbCh0aGlzLCBSLkRlYnVnLnJldGhyb3coXCJSLlNpbXBsZVVwbGlua1NlcnZlci5faGFuZGxlU2Vzc2lvbkV4cGlyZSguLi4pXCIpKTtcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICB9LFxyXG4gICAgICAgIC8qKiBcclxuICAgICAgICAqIDxwPlNldHRpbmcgdXAgYSBjb25uZWN0aW9uIGluIG9yZGVyIHRvIGluaXRpYWxpZXMgbWV0aG9kcyBhbmQgdG8gcHJvdmlkZXMgc3BlY2lmaWNzIGxpc3RlbmVycyBvbiB0aGUgc29ja2V0PC9wPlxyXG4gICAgICAgICogQG1ldGhvZCBDb25uZWN0aW9uXHJcbiAgICAgICAgKiBAcGFyYW0ge29iamVjdH0gcGlkIFxyXG4gICAgICAgICogQHBhcmFtIHtvYmplY3R9IHNvY2tldFxyXG4gICAgICAgICogQHBhcmFtIHtvYmplY3R9IGhhbmRsZVNvY2tldERpc2Nvbm5lY3Rpb25cclxuICAgICAgICAqIEBwYXJhbSB7b2JqZWN0fSBsaW5rU2Vzc2lvbiBcclxuICAgICAgICAqIEBwYXJhbSB7b2JqZWN0fSB1bmxpbmtTZXNzaW9uXHJcbiAgICAgICAgKi9cclxuICAgICAgICBDb25uZWN0aW9uOiBmdW5jdGlvbiBDb25uZWN0aW9uKHBpZCwgc29ja2V0LCBoYW5kbGVTb2NrZXREaXNjb25uZWN0aW9uLCBsaW5rU2Vzc2lvbiwgdW5saW5rU2Vzc2lvbikge1xyXG4gICAgICAgICAgICB0aGlzLl9waWQgPSBwaWQ7XHJcbiAgICAgICAgICAgIHRoaXMudW5pcXVlSWQgPSBfLnVuaXF1ZUlkKFwiUi5TaW1wbGVVcGxpbmtTZXJ2ZXIuQ29ubmVjdGlvblwiKTtcclxuICAgICAgICAgICAgdGhpcy5fc29ja2V0ID0gc29ja2V0O1xyXG4gICAgICAgICAgICB0aGlzLl9oYW5kbGVTb2NrZXREaXNjb25uZWN0aW9uID0gaGFuZGxlU29ja2V0RGlzY29ubmVjdGlvbjtcclxuICAgICAgICAgICAgdGhpcy5fbGlua1Nlc3Npb24gPSBsaW5rU2Vzc2lvbjtcclxuICAgICAgICAgICAgdGhpcy5fdW5saW5rU2Vzc2lvbiA9IHVubGlua1Nlc3Npb247XHJcbiAgICAgICAgICAgIHRoaXMuX2JpbmRIYW5kbGVycygpO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgX0Nvbm5lY3Rpb25Qcm90b1Byb3BzOiAvKiogQGxlbmRzIFIuU2ltcGxlVXBsaW5rU2VydmVyLkNvbm5lY3Rpb24ucHJvdG90eXBlICove1xyXG4gICAgICAgICAgICBfc29ja2V0OiBudWxsLFxyXG4gICAgICAgICAgICBfcGlkOiBudWxsLFxyXG4gICAgICAgICAgICB1bmlxdWVJZDogbnVsbCxcclxuICAgICAgICAgICAgZ3VpZDogbnVsbCxcclxuICAgICAgICAgICAgX2hhbmRsZVNvY2tldERpc2Nvbm5lY3Rpb246IG51bGwsXHJcbiAgICAgICAgICAgIF9saW5rU2Vzc2lvbjogbnVsbCxcclxuICAgICAgICAgICAgX3VubGlua1Nlc3Npb246IG51bGwsXHJcbiAgICAgICAgICAgIF9zdWJzY3JpYmVUbzogbnVsbCxcclxuICAgICAgICAgICAgX3Vuc3Vic2NyaWJlRnJvbTogbnVsbCxcclxuICAgICAgICAgICAgX2xpc3RlblRvOiBudWxsLFxyXG4gICAgICAgICAgICBfdW5saXN0ZW5Gcm9tOiBudWxsLFxyXG4gICAgICAgICAgICBfZGlzY29ubmVjdGVkOiBudWxsLFxyXG4gICAgICAgICAgICAvKiogXHJcbiAgICAgICAgICAgICogPHA+U2V0dGluZyB1cCB0aGUgc3BlY2lmaWNzIGxpc3RlbmVycyBmb3IgdGhlIHNvY2tldDwvcD5cclxuICAgICAgICAgICAgKiBAbWV0aG9kIF9iaW5kSGFuZGxlcnNcclxuICAgICAgICAgICAgKi9cclxuICAgICAgICAgICAgX2JpbmRIYW5kbGVyczogZnVuY3Rpb24gX2JpbmRIYW5kbGVycygpIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuX3NvY2tldC5vbihcImhhbmRzaGFrZVwiLCBSLnNjb3BlKHRoaXMuX2hhbmRsZUhhbmRzaGFrZSwgdGhpcykpO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fc29ja2V0Lm9uKFwic3Vic2NyaWJlVG9cIiwgUi5zY29wZSh0aGlzLl9oYW5kbGVTdWJzY3JpYmVUbywgdGhpcykpO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fc29ja2V0Lm9uKFwidW5zdWJzY3JpYmVGcm9tXCIsIFIuc2NvcGUodGhpcy5faGFuZGxlVW5zdWJzY3JpYmVGcm9tLCB0aGlzKSk7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9zb2NrZXQub24oXCJsaXN0ZW5Ub1wiLCBSLnNjb3BlKHRoaXMuX2hhbmRsZUxpc3RlblRvLCB0aGlzKSk7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9zb2NrZXQub24oXCJ1bmxpc3RlbkZyb21cIiwgUi5zY29wZSh0aGlzLl9oYW5kbGVVbmxpc3RlbkZyb20sIHRoaXMpKTtcclxuICAgICAgICAgICAgICAgIHRoaXMuX3NvY2tldC5vbihcImRpc2Nvbm5lY3RcIiwgUi5zY29wZSh0aGlzLl9oYW5kbGVEaXNjb25uZWN0LCB0aGlzKSk7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9zb2NrZXQub24oXCJ1bmhhbmRzaGFrZVwiLCBSLnNjb3BlKHRoaXMuX2hhbmRsZVVuSGFuZHNoYWtlLCB0aGlzKSk7XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIC8qKlxyXG4gICAgICAgICAgICAqIDxwPiBTaW1wbHkgZW1pdCBhIHNwZWNpZmljIGFjdGlvbiBvbiB0aGUgc29ja2V0IDwvcD5cclxuICAgICAgICAgICAgKiBAbWV0aG9kIGVtaXRcclxuICAgICAgICAgICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSBUaGUgbmFtZSBvZiB0aGUgYWN0aW9uIHRvIHNlbmRcclxuICAgICAgICAgICAgKiBAcGFyYW0ge29iamVjdH0gcGFyYW1zIFRoZSBwYXJhbXMgXHJcbiAgICAgICAgICAgICovXHJcbiAgICAgICAgICAgIGVtaXQ6IGZ1bmN0aW9uIGVtaXQobmFtZSwgcGFyYW1zKSB7XHJcbiAgICAgICAgICAgICAgICBSLkRlYnVnLmRldihmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oXCJbQ10gPj4+IFwiICsgbmFtZSwgcGFyYW1zKTtcclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fc29ja2V0LmVtaXQobmFtZSwgcGFyYW1zKTtcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgLyoqXHJcbiAgICAgICAgICAgICogPHA+IFRyaWdnZXJlZCBieSB0aGUgcmVjZW50bHkgY29ubmVjdGVkIGNsaWVudC4gPGJyIC8+XHJcbiAgICAgICAgICAgICogQ29tYmluZXMgbWV0aG9kcyBvZiBzdWJzY3JpcHRpb25zIHRoYXQgd2lsbCBiZSB0cmlnZ2VyZWQgYnkgdGhlIGNsaWVudCB2aWEgc29ja2V0IGxpc3RlbmluZzwvcD5cclxuICAgICAgICAgICAgKiBAbWV0aG9kIF9oYW5kbGVIYW5kc2hha2VcclxuICAgICAgICAgICAgKiBAcGFyYW0ge1N0cmluZ30gcGFyYW1zIENvbnRhaW5zIHRoZSB1bmlxdWUgc3RyaW5nIEdVSURcclxuICAgICAgICAgICAgKi9cclxuICAgICAgICAgICAgX2hhbmRsZUhhbmRzaGFrZTogZnVuY3Rpb24gX2hhbmRsZUhhbmRzaGFrZShwYXJhbXMpIHtcclxuICAgICAgICAgICAgICAgIGlmKCFfLmhhcyhwYXJhbXMsIFwiZ3VpZFwiKSB8fCAhXy5pc1N0cmluZyhwYXJhbXMuZ3VpZCkpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLmVtaXQoXCJlcnJcIiwgeyBlcnI6IFwiaGFuZHNoYWtlLnBhcmFtcy5ndWlkOiBleHBlY3RlZCBTdHJpbmcuXCJ9KTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGVsc2UgaWYodGhpcy5ndWlkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5lbWl0KFwiZXJyXCIsIHsgZXJyOiBcImhhbmRzaGFrZTogc2Vzc2lvbiBhbHJlYWR5IGxpbmtlZC5cIn0pO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY28oZnVuY3Rpb24qKCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmd1aWQgPSBwYXJhbXMuZ3VpZDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdmFyIHMgPSB5aWVsZCB0aGlzLl9saW5rU2Vzc2lvbih0aGlzLCB0aGlzLmd1aWQpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmVtaXQoXCJoYW5kc2hha2UtYWNrXCIsIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBpZDogdGhpcy5fcGlkLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVjb3ZlcmVkOiBzLnJlY292ZXJlZCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX3N1YnNjcmliZVRvID0gcy5zdWJzY3JpYmVUbztcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5fdW5zdWJzY3JpYmVGcm9tID0gcy51bnN1YnNjcmliZUZyb207XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX2xpc3RlblRvID0gcy5saXN0ZW5UbztcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5fdW5saXN0ZW5Gcm9tID0gcy51bmxpc3RlbkZyb207XHJcbiAgICAgICAgICAgICAgICAgICAgfSkuY2FsbCh0aGlzLCBSLkRlYnVnLnJldGhyb3coXCJSLlNpbXBsZVVwbGlua1NlcnZlci5Db25uZWN0aW9uLl9oYW5kbGVIYW5kc2hha2UoLi4uKVwiKSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIC8qKlxyXG4gICAgICAgICAgICAqIDxwPiBUcmlnZ2VyZWQgYnkgdGhlIHJlY2VudGx5IGRpc2Nvbm5lY3RlZCBjbGllbnQuIDxiciAvPlxyXG4gICAgICAgICAgICAqIFJlbW92ZXMgbWV0aG9kcyBvZiBzdWJzY3JpcHRpb25zPC9wPlxyXG4gICAgICAgICAgICAqIEBtZXRob2QgX2hhbmRsZUhhbmRzaGFrZVxyXG4gICAgICAgICAgICAqL1xyXG4gICAgICAgICAgICBfaGFuZGxlVW5IYW5kc2hha2U6IGZ1bmN0aW9uIF9oYW5kbGVVbkhhbmRzaGFrZSgpIHtcclxuICAgICAgICAgICAgICAgIGlmKCF0aGlzLmd1aWQpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLmVtaXQoXCJlcnJcIiwgeyBlcnI6IFwidW5oYW5kc2hha2U6IG5vIGFjdGl2ZSBzZXNzaW9uLlwifSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICBjbyhmdW5jdGlvbiooKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX3N1YnNjcmliZVRvID0gbnVsbDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5fdW5zdWJzY3JpYmVGcm9tID0gbnVsbDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5fbGlzdGVuVG8gPSBudWxsO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl91bmxpc3RlbkZyb20gPSBudWxsO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB2YXIgcyA9IHlpZWxkIHRoaXMuX3VubGlua1Nlc3Npb24odGhpcywgdGhpcy5ndWlkKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5lbWl0KFwidW5oYW5kc2hha2UtYWNrXCIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmd1aWQgPSBudWxsO1xyXG4gICAgICAgICAgICAgICAgICAgIH0pLmNhbGwodGhpcywgUi5EZWJ1Zy5yZXRocm93KFwiUi5TaW1wbGVVcGxpbmtTZXJ2ZXIuQ29ubmVjdGlvbi5faGFuZGxlVW5IYW5kc2hha2UoLi4uKVwiKSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIC8qKiBcclxuICAgICAgICAgICAgKiA8cD5NYXBzIHRoZSB0cmlnZ2VyZWQgZXZlbnQgd2l0aCB0aGUgX3N1YnNjcmliZVRvIG1ldGhvZHMgPC9wPlxyXG4gICAgICAgICAgICAqIEBtZXRob2QgX2hhbmRsZVN1YnNjcmliZVRvXHJcbiAgICAgICAgICAgICogQHBhcmFtIHtvYmplY3R9IHBhcmFtcyBDb250YWlucyB0aGUga2V5IHByb3ZpZGVkIGJ5IGNsaWVudFxyXG4gICAgICAgICAgICAqL1xyXG4gICAgICAgICAgICBfaGFuZGxlU3Vic2NyaWJlVG86IGZ1bmN0aW9uIF9oYW5kbGVTdWJzY3JpYmVUbyhwYXJhbXMpIHtcclxuICAgICAgICAgICAgICAgIGlmKCFfLmhhcyhwYXJhbXMsIFwia2V5XCIpIHx8ICFfLmlzU3RyaW5nKHBhcmFtcy5rZXkpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5lbWl0KFwiZXJyXCIsIHsgZXJyOiBcInN1YnNjcmliZVRvLnBhcmFtcy5rZXk6IGV4cGVjdGVkIFN0cmluZy5cIiB9KTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGVsc2UgaWYoIXRoaXMuX3N1YnNjcmliZVRvKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5lbWl0KFwiZXJyXCIsIHsgZXJyOiBcInN1YnNjcmliZVRvOiByZXF1aXJlcyBoYW5kc2hha2UuXCIgfSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLl9zdWJzY3JpYmVUbyhwYXJhbXMua2V5KTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgLyoqIFxyXG4gICAgICAgICAgICAqIDxwPk1hcHMgdGhlIHRyaWdnZXJlZCBldmVudCB3aXRoIHRoZSBfdW5zdWJzY3JpYmVGcm9tIG1ldGhvZHM8L3A+XHJcbiAgICAgICAgICAgICogQG1ldGhvZCBfaGFuZGxlVW5zdWJzY3JpYmVGcm9tXHJcbiAgICAgICAgICAgICogQHBhcmFtIHtvYmplY3R9IHBhcmFtcyBDb250YWlucyB0aGUga2V5IHByb3ZpZGVkIGJ5IGNsaWVudFxyXG4gICAgICAgICAgICAqL1xyXG4gICAgICAgICAgICBfaGFuZGxlVW5zdWJzY3JpYmVGcm9tOiBmdW5jdGlvbiBfaGFuZGxlVW5zdWJzY3JpYmVGcm9tKHBhcmFtcykge1xyXG4gICAgICAgICAgICAgICAgaWYoIV8uaGFzKHBhcmFtcywgXCJrZXlcIikgfHwgIV8uaXNTdHJpbmcocGFyYW1zLmtleSkpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLmVtaXQoXCJlcnJcIiwgeyBlcnI6IFwidW5zdWJzY3JpYmVGcm9tLnBhcmFtcy5rZXk6IGV4cGVjdGVkIFN0cmluZy5cIiB9KTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGVsc2UgaWYoIXRoaXMuX3Vuc3Vic2NyaWJlRnJvbSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuZW1pdChcImVyclwiLCB7IGVycjogXCJ1bnN1YnNjcmliZUZyb206IHJlcXVpcmVzIGhhbmRzaGFrZS5cIiB9KTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3Vuc3Vic2NyaWJlRnJvbShwYXJhbXMua2V5KTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgLyoqIFxyXG4gICAgICAgICAgICAqIDxwPk1hcHMgdGhlIHRyaWdnZXJlZCBldmVudCB3aXRoIHRoZSBsaXN0ZW5UbyBtZXRob2RzPC9wPlxyXG4gICAgICAgICAgICAqIEBtZXRob2QgX2hhbmRsZUxpc3RlblRvXHJcbiAgICAgICAgICAgICogQHBhcmFtIHtvYmplY3R9IHBhcmFtcyBDb250YWlucyB0aGUgZXZlbnROYW1lIHByb3ZpZGVkIGJ5IGNsaWVudFxyXG4gICAgICAgICAgICAqL1xyXG4gICAgICAgICAgICBfaGFuZGxlTGlzdGVuVG86IGZ1bmN0aW9uIF9oYW5kbGVMaXN0ZW5UbyhwYXJhbXMpIHtcclxuICAgICAgICAgICAgICAgIGlmKCFfLmhhcyhwYXJhbXMsIFwiZXZlbnROYW1lXCIpIHx8ICFfLmlzU3RyaW5nKHBhcmFtcy5ldmVudE5hbWUpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5lbWl0KFwiZXJyXCIsIHsgZXJyOiBcImxpc3RlblRvLnBhcmFtcy5ldmVudE5hbWU6IGV4cGVjdGVkIFN0cmluZy5cIiB9KTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGVsc2UgaWYoIXRoaXMuX2xpc3RlblRvKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5lbWl0KFwiZXJyXCIsIHsgZXJyOiBcImxpc3RlblRvOiByZXF1aXJlcyBoYW5kc2hha2UuXCIgfSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLmxpc3RlblRvKHBhcmFtcy5ldmVudE5hbWUpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAvKiogXHJcbiAgICAgICAgICAgICogPHA+TWFwcyB0aGUgdHJpZ2dlcmVkIGV2ZW50IHdpdGggdGhlIHVubGlzdGVuRnJvbSBtZXRob2RzPC9wPlxyXG4gICAgICAgICAgICAqIEBtZXRob2QgX2hhbmRsZVVubGlzdGVuRnJvbVxyXG4gICAgICAgICAgICAqIEBwYXJhbSB7b2JqZWN0fSBwYXJhbXMgQ29udGFpbnMgdGhlIGV2ZW50TmFtZSBwcm92aWRlZCBieSBjbGllbnRcclxuICAgICAgICAgICAgKi9cclxuICAgICAgICAgICAgX2hhbmRsZVVubGlzdGVuRnJvbTogZnVuY3Rpb24gX2hhbmRsZVVubGlzdGVuRnJvbShwYXJhbXMpIHtcclxuICAgICAgICAgICAgICAgIGlmKCFfLmhhcyhwYXJhbXMsIFwiZXZlbnROYW1lXCIpIHx8ICFfLmlzU3RyaW5nKHBhcmFtcy5ldmVudE5hbWUpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5lbWl0KFwiZXJyXCIsIHsgZXJyOiBcInVubGlzdGVuRnJvbS5wYXJhbXMuZXZlbnROYW1lOiBleHBlY3RlZCBTdHJpbmcuXCIgfSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBlbHNlIGlmKCF0aGlzLnVubGlzdGVuRnJvbSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX2VtaXQoXCJlcnJcIiwgeyBlcnI6IFwidW5saXN0ZW5Gcm9tOiByZXF1aXJlcyBoYW5kc2hha2UuXCIgfSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLnVubGlzdGVuRnJvbShwYXJhbXMuZXZlbnROYW1lKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgIC8qKiBcclxuICAgICAgICAgICAgKiA8cD5UcmlnZ2VyZWQgYnkgdGhlIHJlY2VudGx5IGRpc2Nvbm5lY3RlZCBjbGllbnQuPC9wPlxyXG4gICAgICAgICAgICAqIEBtZXRob2QgX2hhbmRsZURpc2Nvbm5lY3RcclxuICAgICAgICAgICAgKi9cclxuICAgICAgICAgICAgX2hhbmRsZURpc2Nvbm5lY3Q6IGZ1bmN0aW9uIF9oYW5kbGVEaXNjb25uZWN0KCkge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5faGFuZGxlU29ja2V0RGlzY29ubmVjdGlvbih0aGlzLnVuaXF1ZUlkLCBmYWxzZSk7XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgfSxcclxuICAgICAgICAvKiogXHJcbiAgICAgICAgKiA8cD5TZXR0aW5nIHVwIGEgc2Vzc2lvbjwvcD5cclxuICAgICAgICAqIEBtZXRob2QgU2Vzc2lvblxyXG4gICAgICAgICogQHBhcmFtIHtvYmplY3R9IHBpZCBcclxuICAgICAgICAqIEBwYXJhbSB7b2JqZWN0fSBzdG9yZUV2ZW50c1xyXG4gICAgICAgICogQHBhcmFtIHtvYmplY3R9IGV2ZW50c0V2ZW50c1xyXG4gICAgICAgICogQHBhcmFtIHtvYmplY3R9IHNlc3Npb25zRXZlbnRzIFxyXG4gICAgICAgICogQHBhcmFtIHtvYmplY3R9IHRpbWVvdXRcclxuICAgICAgICAqL1xyXG4gICAgICAgIFNlc3Npb246IGZ1bmN0aW9uIFNlc3Npb24oZ3VpZCwgc3RvcmVFdmVudHMsIGV2ZW50c0V2ZW50cywgc2Vzc2lvbnNFdmVudHMsIHRpbWVvdXQpIHtcclxuICAgICAgICAgICAgdGhpcy5fZ3VpZCA9IGd1aWQ7XHJcbiAgICAgICAgICAgIHRoaXMuX3N0b3JlRXZlbnRzID0gc3RvcmVFdmVudHM7XHJcbiAgICAgICAgICAgIHRoaXMuX2V2ZW50c0V2ZW50cyA9IGV2ZW50c0V2ZW50cztcclxuICAgICAgICAgICAgdGhpcy5fc2Vzc2lvbnNFdmVudHMgPSBzZXNzaW9uc0V2ZW50cztcclxuICAgICAgICAgICAgdGhpcy5fbWVzc2FnZVF1ZXVlID0gW107XHJcbiAgICAgICAgICAgIHRoaXMuX3RpbWVvdXREdXJhdGlvbiA9IHRpbWVvdXQ7XHJcbiAgICAgICAgICAgIHRoaXMuX2V4cGlyZSA9IFIuc2NvcGUodGhpcy5fZXhwaXJlLCB0aGlzKTtcclxuICAgICAgICAgICAgdGhpcy5fZXhwaXJlVGltZW91dCA9IHNldFRpbWVvdXQodGhpcy5fZXhwaXJlLCB0aGlzLl90aW1lb3V0RHVyYXRpb24pO1xyXG4gICAgICAgICAgICB0aGlzLl9zdWJzY3JpcHRpb25zID0ge307XHJcbiAgICAgICAgICAgIHRoaXMuX2xpc3RlbmVycyA9IHt9O1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgX1Nlc3Npb25Qcm90b1Byb3BzOiAvKiogQGxlbmRzIFIuU2ltcGxlVXBsaW5rU2VydmVyLlNlc3Npb24ucHJvdG90eXBlICove1xyXG4gICAgICAgICAgICBfZ3VpZDogbnVsbCxcclxuICAgICAgICAgICAgX2Nvbm5lY3Rpb246IG51bGwsXHJcbiAgICAgICAgICAgIF9zdWJzY3JpcHRpb25zOiBudWxsLFxyXG4gICAgICAgICAgICBfbGlzdGVuZXJzOiBudWxsLFxyXG4gICAgICAgICAgICBfc3RvcmVFdmVudHM6IG51bGwsXHJcbiAgICAgICAgICAgIF9ldmVudHNFdmVudHM6IG51bGwsXHJcbiAgICAgICAgICAgIF9zZXNzaW9uc0V2ZW50czogbnVsbCxcclxuICAgICAgICAgICAgX21lc3NhZ2VRdWV1ZTogbnVsbCxcclxuICAgICAgICAgICAgX2V4cGlyZVRpbWVvdXQ6IG51bGwsXHJcbiAgICAgICAgICAgIF90aW1lb3V0RHVyYXRpb246IG51bGwsXHJcbiAgICAgICAgICAgIC8qKlxyXG4gICAgICAgICAgICAqIDxwPkJpbmQgdGhlIHN1YnNjcmliaW5nIGFuZCB1bnN1YnNjcmliaW5nIG1ldGhvZHMgd2hlbiBhIGNvbm5lY3Rpb24gaXMgZXN0YWJsaXNoZWQgPGJyIC8+XHJcbiAgICAgICAgICAgICogTWV0aG9kcyB0aGF0IHRyaWdnZXIgb24gY2xpZW50IGlzc3VlcyAobGlrZSBlbWl0KFwic3Vic2NyaWJlVG9cIiksIGVtaXQoXCJ1bnN1YnNjcmliZUZyb21cIikpPC9wPlxyXG4gICAgICAgICAgICAqIEBtZXRob2QgYXR0YWNoQ29ubmVjdGlvblxyXG4gICAgICAgICAgICAqIEBwYXJhbSB7U2ltcGxlVXBsaW5rU2VydmVyLkNvbm5lY3Rpb259IGNvbm5lY3Rpb24gdGhlIGN1cnJlbnQgY3JlYXRlZCBjb25uZWN0aW9uXHJcbiAgICAgICAgICAgICogQHJldHVybiB7b2JqZWN0fSB0aGUgYmluZGVkIG9iamVjdCB3aXRoIG1ldGhvZHNcclxuICAgICAgICAgICAgKi9cclxuICAgICAgICAgICAgYXR0YWNoQ29ubmVjdGlvbjogZnVuY3Rpb24gYXR0YWNoQ29ubmVjdGlvbihjb25uZWN0aW9uKSB7XHJcbiAgICAgICAgICAgICAgICB2YXIgcmVjb3ZlcmVkID0gKHRoaXMuX2Nvbm5lY3Rpb24gIT09IG51bGwpO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5kZXRhY2hDb25uZWN0aW9uKCk7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9jb25uZWN0aW9uID0gY29ubmVjdGlvbjtcclxuICAgICAgICAgICAgICAgIF8uZWFjaCh0aGlzLl9tZXNzYWdlUXVldWUsIGZ1bmN0aW9uKG0pIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25uZWN0aW9uLmVtaXQobS5uYW1lLCBtLnBhcmFtcyk7XHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgIHRoaXMuX21lc3NhZ2VRdWV1ZSA9IG51bGw7XHJcbiAgICAgICAgICAgICAgICBjbGVhclRpbWVvdXQodGhpcy5fZXhwaXJlVGltZW91dCk7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgICAgIHJlY292ZXJlZDogcmVjb3ZlcmVkLFxyXG4gICAgICAgICAgICAgICAgICAgIHN1YnNjcmliZVRvOiBSLnNjb3BlKHRoaXMuc3Vic2NyaWJlVG8sIHRoaXMpLFxyXG4gICAgICAgICAgICAgICAgICAgIHVuc3Vic2NyaWJlRnJvbTogUi5zY29wZSh0aGlzLnVuc3Vic2NyaWJlRnJvbSwgdGhpcyksXHJcbiAgICAgICAgICAgICAgICAgICAgbGlzdGVuVG86IFIuc2NvcGUodGhpcy5saXN0ZW5UbywgdGhpcyksXHJcbiAgICAgICAgICAgICAgICAgICAgdW5saXN0ZW5Gcm9tOiBSLnNjb3BlKHRoaXMudW5saXN0ZW5Gcm9tLCB0aGlzKSxcclxuICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIC8qKlxyXG4gICAgICAgICAgICAqIDxwPlJlbW92ZSB0aGUgcHJldmlvdXNseSBhZGRlZCBjb25uZWN0aW9uLCBhbmQgY2xlYW4gdGhlIG1lc3NhZ2UgcXVldWUgPC9wPlxyXG4gICAgICAgICAgICAqIEBtZXRob2QgZGV0YWNoQ29ubmVjdGlvblxyXG4gICAgICAgICAgICAqL1xyXG4gICAgICAgICAgICBkZXRhY2hDb25uZWN0aW9uOiBmdW5jdGlvbiBkZXRhY2hDb25uZWN0aW9uKCkge1xyXG4gICAgICAgICAgICAgICAgaWYodGhpcy5fY29ubmVjdGlvbiA9PT0gbnVsbCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX2Nvbm5lY3Rpb24gPSBudWxsO1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX21lc3NhZ2VRdWV1ZSA9IFtdO1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX2V4cGlyZVRpbWVvdXQgPSBzZXRUaW1lb3V0KHRoaXMuX2V4cGlyZSwgdGhpcy5fdGltZW91dER1cmF0aW9uKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgLyoqXHJcbiAgICAgICAgICAgICogQG1ldGhvZCB0ZXJtaW5hdGVcclxuICAgICAgICAgICAgKi9cclxuICAgICAgICAgICAgdGVybWluYXRlOiBmdW5jdGlvbiB0ZXJtaW5hdGUoKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9leHBpcmUoKTtcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgLyoqIFxyXG4gICAgICAgICAgICAqIDxwPk1ldGhvZCBpbnZva2VkIGJ5IGNsaWVudCB2aWEgc29ja2V0IGVtaXQgPGJyIC8+XHJcbiAgICAgICAgICAgICogU3RvcmUgdGhlIF9zaWduYWxVcGRhdGUgbWV0aG9kIGluIHN1YnNjcmlwdGlvbiA8YnIgLz5cclxuICAgICAgICAgICAgKiBBZGQgYSBsaXN0ZW5lciB0aGF0IHdpbGwgY2FsbCBfc2lnbmFsVXBkYXRlIHdoZW4gdHJpZ2dlcmVkIDwvcD5cclxuICAgICAgICAgICAgKiBAbWV0aG9kIHN1YnNjcmliZVRvXHJcbiAgICAgICAgICAgICogQHBhcmFtIHtzdHJpbmd9IGtleSBUaGUga2V5IHRvIHN1YnNjcmliZVxyXG4gICAgICAgICAgICAqL1xyXG4gICAgICAgICAgICBzdWJzY3JpYmVUbzogZnVuY3Rpb24gc3Vic2NyaWJlVG8oa2V5KSB7XHJcbiAgICAgICAgICAgICAgICBSLkRlYnVnLmRldihSLnNjb3BlKGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGFzc2VydCghXy5oYXModGhpcy5fc3Vic2NyaXB0aW9ucywga2V5KSwgXCJSLlNpbXBsZVVwbGlua1NlcnZlci5TZXNzaW9uLnN1YnNjcmliZVRvKC4uLik6IGFscmVhZHkgc3Vic2NyaWJlZC5cIik7XHJcbiAgICAgICAgICAgICAgICB9LCB0aGlzKSk7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9zdWJzY3JpcHRpb25zW2tleV0gPSB0aGlzLl9zaWduYWxVcGRhdGUoKTtcclxuICAgICAgICAgICAgICAgIHRoaXMuX3N0b3JlRXZlbnRzLmFkZExpc3RlbmVyKFwic2V0OlwiICsga2V5LCB0aGlzLl9zdWJzY3JpcHRpb25zW2tleV0pO1xyXG4gICAgICAgICAgICB9LFxyXG5cclxuICAgICAgICAgICAgLyoqIFxyXG4gICAgICAgICAgICAqIDxwPk1ldGhvZCBpbnZva2VkIGJ5IGNsaWVudCB2aWEgc29ja2V0IGVtaXQgPGJyIC8+XHJcbiAgICAgICAgICAgICogUmVtb3ZlIGEgbGlzdGVuZXIgYWNjb3JkaW5nIHRvIHRoZSBrZXk8L3A+XHJcbiAgICAgICAgICAgICogQG1ldGhvZCBzdWJzY3JpYmVUb1xyXG4gICAgICAgICAgICAqIEBwYXJhbSB7c3RyaW5nfSBrZXkgVGhlIGtleSB0byB1bnN1YnNjcmliZVxyXG4gICAgICAgICAgICAqL1xyXG4gICAgICAgICAgICB1bnN1YnNjcmliZUZyb206IGZ1bmN0aW9uIHVuc3Vic2NyaWJlRnJvbShrZXkpIHtcclxuICAgICAgICAgICAgICAgIFIuRGVidWcuZGV2KFIuc2NvcGUoZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgYXNzZXJ0KF8uaGFzKHRoaXMuX3N1YnNjcmlwdGlvbnMsIGtleSksIFwiUi5TaW1wbGVVcGxpbmtTZXJ2ZXIuU2Vzc2lvbi51bnN1YnNjcmliZUZyb20oLi4uKTogbm90IHN1YnNjcmliZWQuXCIpO1xyXG4gICAgICAgICAgICAgICAgfSwgdGhpcykpO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fc3RvcmVFdmVudHMucmVtb3ZlTGlzdGVuZXIoXCJzZXQ6XCIgKyBrZXksIHRoaXMuX3N1YnNjcmlwdGlvbnNba2V5XSk7XHJcbiAgICAgICAgICAgICAgICBkZWxldGUgdGhpcy5fc3Vic2NyaXB0aW9uc1trZXldO1xyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAvKipcclxuICAgICAgICAgICAgKiA8cD4gU2ltcGx5IGVtaXQgYSBzcGVjaWZpYyBhY3Rpb24gb24gdGhlIHNvY2tldCA8L3A+XHJcbiAgICAgICAgICAgICogQG1ldGhvZCBfZW1pdFxyXG4gICAgICAgICAgICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIFRoZSBuYW1lIG9mIHRoZSBhY3Rpb24gdG8gc2VuZFxyXG4gICAgICAgICAgICAqIEBwYXJhbSB7b2JqZWN0fSBwYXJhbXMgVGhlIHBhcmFtcyBcclxuICAgICAgICAgICAgKi9cclxuICAgICAgICAgICAgX2VtaXQ6IGZ1bmN0aW9uIF9lbWl0KG5hbWUsIHBhcmFtcykge1xyXG4gICAgICAgICAgICAgICAgUi5EZWJ1Zy5kZXYoZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS53YXJuKFwiW1NdID4+PiBcIiArIG5hbWUsIHBhcmFtcyk7XHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgIGlmKHRoaXMuX2Nvbm5lY3Rpb24gIT09IG51bGwpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLl9jb25uZWN0aW9uLmVtaXQobmFtZSwgcGFyYW1zKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX21lc3NhZ2VRdWV1ZS5wdXNoKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgbmFtZTogbmFtZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgcGFyYW1zOiBwYXJhbXMsXHJcbiAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIC8qKiA8cD5QdXNoIGFuIHVwZGF0ZSBhY3Rpb24gb24gdGhlIHNvY2tldC4gPGJyIC8+XHJcbiAgICAgICAgICAgICogVGhlIGNsaWVudCBpcyBsaXN0ZW5pbmcgb24gdGhlIGFjdGlvbiBcInVwZGF0ZVwiIHNvY2tldCA8L3A+XHJcbiAgICAgICAgICAgICogQG1ldGhvZCBfc2lnbmFsVXBkYXRlXHJcbiAgICAgICAgICAgICovXHJcbiAgICAgICAgICAgIF9zaWduYWxVcGRhdGU6IGZ1bmN0aW9uIF9zaWduYWxVcGRhdGUoKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gUi5zY29wZShmdW5jdGlvbihwYXRjaCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX2VtaXQoXCJ1cGRhdGVcIiwgcGF0Y2gpO1xyXG4gICAgICAgICAgICAgICAgfSwgdGhpcyk7XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIC8qKiA8cD5QdXNoIGFuIGV2ZW50IGFjdGlvbiBvbiB0aGUgc29ja2V0LiA8YnIgLz5cclxuICAgICAgICAgICAgKiBUaGUgY2xpZW50IGlzIGxpc3RlbmluZyBvbiB0aGUgYWN0aW9uIFwiZXZlbnRcIiBzb2NrZXQgPC9wPlxyXG4gICAgICAgICAgICAqIEBtZXRob2QgX3NpZ25hbEV2ZW50XHJcbiAgICAgICAgICAgICovXHJcbiAgICAgICAgICAgIF9zaWduYWxFdmVudDogZnVuY3Rpb24gX3NpZ25hbEV2ZW50KGV2ZW50TmFtZSkge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIFIuc2NvcGUoZnVuY3Rpb24ocGFyYW1zKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fZW1pdChcImV2ZW50XCIsIHsgZXZlbnROYW1lOiBldmVudE5hbWUsIHBhcmFtczogcGFyYW1zIH0pO1xyXG4gICAgICAgICAgICAgICAgfSwgdGhpcyk7XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIC8qKlxyXG4gICAgICAgICAgICAqIEBtZXRob2QgX2V4cGlyZVxyXG4gICAgICAgICAgICAqL1xyXG4gICAgICAgICAgICBfZXhwaXJlOiBmdW5jdGlvbiBfZXhwaXJlKCkge1xyXG4gICAgICAgICAgICAgICAgXy5lYWNoKF8ua2V5cyh0aGlzLl9zdWJzY3JpcHRpb25zKSwgUi5zY29wZSh0aGlzLnVuc3Vic2NyaWJlRnJvbSwgdGhpcykpO1xyXG4gICAgICAgICAgICAgICAgXy5lYWNoKF8ua2V5cyh0aGlzLl9saXN0ZW5lcnMpLCBSLnNjb3BlKHRoaXMudW5saXN0ZW5Gcm9tLCB0aGlzKSk7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9zZXNzaW9uc0V2ZW50cy5lbWl0KFwiZXhwaXJlXCIsIHRoaXMuX2d1aWQpO1xyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAvKipcclxuICAgICAgICAgICAgKiA8cD4gQ3JlYXRlIGEgbGlzdGVuZXIgZm9yIHRoZSBldmVudHMgPC9wPlxyXG4gICAgICAgICAgICAqIEBtZXRob2QgbGlzdGVuVG9cclxuICAgICAgICAgICAgKiBAcGFyYW0ge3N0cmluZ30gZXZlbnROYW1lIFRoZSBuYW1lIG9mIHRoZSBldmVudCB0aGF0IHdpbGwgYmUgcmVnaXN0ZXJlZFxyXG4gICAgICAgICAgICAqL1xyXG4gICAgICAgICAgICBsaXN0ZW5UbzogZnVuY3Rpb24gbGlzdGVuVG8oZXZlbnROYW1lKSB7XHJcbiAgICAgICAgICAgICAgICBSLkRlYnVnLmRldihSLnNjb3BlKGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGFzc2VydCghXy5oYXModGhpcy5fbGlzdGVuZXJzLCBrZXkpLCBcIlIuU2ltcGxlVXBsaW5rU2VydmVyLlNlc3Npb24ubGlzdGVuVG8oLi4uKTogYWxyZWFkeSBsaXN0ZW5pbmcuXCIpO1xyXG4gICAgICAgICAgICAgICAgfSwgdGhpcykpO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fbGlzdGVuZXJzW2V2ZW50TmFtZV0gPSB0aGlzLl9zaWduYWxFdmVudChldmVudE5hbWUpO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fZXZlbnRzRXZlbnRzLmFkZExpc3RlbmVyKFwiZW1pdDpcIiArIGV2ZW50TmFtZSwgdGhpcy5fbGlzdGVuZXJzW2V2ZW50TmFtZV0pO1xyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAvKipcclxuICAgICAgICAgICAgKiA8cD4gUmVtb3ZlIGEgbGlzdGVuZXIgZnJvbSB0aGUgZXZlbnRzIDwvcD5cclxuICAgICAgICAgICAgKiBAbWV0aG9kIHVubGlzdGVuRnJvbVxyXG4gICAgICAgICAgICAqIEBwYXJhbSB7c3RyaW5nfSBldmVudE5hbWUgVGhlIG5hbWUgb2YgdGhlIGV2ZW50IHRoYXQgd2lsbCBiZSB1bnJlZ2lzdGVyZWRcclxuICAgICAgICAgICAgKi9cclxuICAgICAgICAgICAgdW5saXN0ZW5Gcm9tOiBmdW5jdGlvbiB1bmxpc3RlbkZyb20oZXZlbnROYW1lKSB7XHJcbiAgICAgICAgICAgICAgICBSLkRlYnVnLmRldihSLnNjb3BlKGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGFzc2VydChfLmhhcyh0aGlzLl9saXN0ZW5lcnMsIGV2ZW50TmFtZSksIFwiUi5TaW1wbGVVcGxpbmtTZXJ2ZXIuU2Vzc2lvbi51bmxpc3RlbkZyb20oLi4uKTogbm90IGxpc3RlbmluZy5cIik7XHJcbiAgICAgICAgICAgICAgICB9LCB0aGlzKSk7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9ldmVudHNFdmVudHMucmVtb3ZlTGlzdGVuZXIoXCJlbWl0OlwiICsgZXZlbnROYW1lLCB0aGlzLl9saXN0ZW5lcnNbZXZlbnROYW1lXSk7XHJcbiAgICAgICAgICAgICAgICBkZWxldGUgdGhpcy5fbGlzdGVuZXJzW2V2ZW50TmFtZV07XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgfSxcclxuICAgIH07XHJcblxyXG4gICAgXy5leHRlbmQoU2ltcGxlVXBsaW5rU2VydmVyLlNpbXBsZVVwbGlua1NlcnZlckluc3RhbmNlLnByb3RvdHlwZSwgU2ltcGxlVXBsaW5rU2VydmVyLl9TaW1wbGVVcGxpbmtTZXJ2ZXJJbnN0YW5jZVByb3RvUHJvcHMpO1xyXG4gICAgXy5leHRlbmQoU2ltcGxlVXBsaW5rU2VydmVyLkNvbm5lY3Rpb24ucHJvdG90eXBlLCBTaW1wbGVVcGxpbmtTZXJ2ZXIuX0Nvbm5lY3Rpb25Qcm90b1Byb3BzKTtcclxuICAgIF8uZXh0ZW5kKFNpbXBsZVVwbGlua1NlcnZlci5TZXNzaW9uLnByb3RvdHlwZSwgU2ltcGxlVXBsaW5rU2VydmVyLl9TZXNzaW9uUHJvdG9Qcm9wcyk7XHJcblxyXG4gICAgcmV0dXJuIFNpbXBsZVVwbGlua1NlcnZlcjtcclxufTtcclxuIl0sInNvdXJjZVJvb3QiOiIvc291cmNlLyJ9