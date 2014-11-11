"use strict";

var _classProps = function (child, staticProps, instanceProps) {
  if (staticProps) Object.defineProperties(child, staticProps);

  if (instanceProps) Object.defineProperties(child.prototype, instanceProps);
};

require("6to5/polyfill");
var Promise = require("bluebird");
module.exports = function (R) {
  var io = require("socket.io");
  var _ = require("lodash");
  var co = require("co");
  var EventEmitter = require("events").EventEmitter;
  var bodyParser = require("body-parser");

  var SimpleUplinkServer = (function () {
    var SimpleUplinkServer = function SimpleUplinkServer(specs) {
      _.dev(function () {
        return specs.store.should.be.an.Array && specs.events.should.be.an.Array && specs.action.should.be.ok && _.isPlainObject(specs.actions) && specs.sessionCreated.should.be.a.Function && specs.sessionTimeout.should.be.a.Number;
      });

      this._specs = specs;
      this._pid = R.guid("SimpleUplinkServer");
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
    };

    _classProps(SimpleUplinkServer, null, {
      setStore: {
        writable: true,
        value: function (key, val) {
          var _this = this;

          return function (fn) {
            try {
              var previousVal = _this._store[key] || {};
              var previousHash = _this._hashes[key] || R.hash(JSON.stringify(previousVal));
              var diff = R.diff(previousVal, val);
              var hash = R.hash(JSON.stringify(val));
              _this._store[key] = val;
              _this._hashes[key] = hash;
              _this._storeEvents.emit("set:" + key, {
                k: key,
                d: diff,
                h: previousHash });
            } catch (err) {
              return fn(R.Debug.extendError(err, "R.SimpleUplinkServer.setStore('" + key + "', '" + val + "')"));
            }
            _.defer(function () {
              fn(null, val);
            });
          };
        }
      },
      getStore: {
        writable: true,
        value: function (key) {
          var _this2 = this;

          return function (fn) {
            var val;
            try {
              _.dev(function () {
                if (!_.has(_this2._store, key)) {
                  console.warn("R.SimpleUplinkServer(...).getStore: no such key (" + key + ")");
                }
              });
              val = _this2._store[key];
            } catch (err) {
              return fn(R.Debug.extendError(err, "R.SimpleUplinkServer.getStore('" + key + "')"));
            }
            _.defer(function () {
              fn(null, val);
            });
          };
        }
      },
      emitEvent: {
        writable: true,
        value: function (eventName, params) {
          this._eventsEvents.emit("emit:" + eventName, params);
        }
      },
      emitDebug: {
        writable: true,
        value: function (guid, params) {
          var _this3 = this;

          _.dev(function () {
            if (_this3._sessions[guid]) {
              _this3._sessions[guid].emit("debug", params);
            }
          });
        }
      },
      emitLog: {
        writable: true,
        value: function (guid, params) {
          if (this._sessions[guid]) {
            this._sessions[guid].emit("log", params);
          }
        }
      },
      emitWarn: {
        writable: true,
        value: function (guid, params) {
          if (this._sessions[guid]) {
            this._sessions[guid].emit("warn", params);
          }
        }
      },
      emitError: {
        writable: true,
        value: function (guid, params) {
          if (this._sessions[guid]) {
            this._sessions[guid].emit("err", params);
          }
        }
      },
      _extractOriginalPath: {
        writable: true,
        value: function () {
          return arguments[arguments.length - 1];
        }
      },
      _bindStoreRoute: {
        writable: true,
        value: function (route) {
          this._storeRouter.route(route, this._extractOriginalPath);
        }
      },
      _bindEventsRoute: {
        writable: true,
        value: function (route) {
          this._eventsRouter.route(route, this._extractOriginalPath);
        }
      },
      _bindActionsRoute: {
        writable: true,
        value: function (handler, route) {
          this._actionsRouter.route(route, _.constant(R.scope(handler, this)));
        }
      },
      installHandlers: {
        writable: true,
        value: function (app, prefix) {
          return _.copromise(regeneratorRuntime.mark(function callee$3$0() {
            var _this4, server;
            return regeneratorRuntime.wrap(function callee$3$0$(context$4$0) {
              while (1) switch (context$4$0.prev = context$4$0.next) {
                case 0:
                  _this4 = this;

                  _.dev(function () {
                    return (_this4._app === null).should.be.ok;
                  });
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
                  context$4$0.next = 17;
                  return this.bootstrap();

                case 17: return context$4$0.abrupt("return", server);
                case 18:
                case "end": return context$4$0.stop();
              }
            }, callee$3$0, this);
          }), this);
        }
      },
      _handleHttpGet: {
        writable: true,
        value: function (req, res, next) {
          co(regeneratorRuntime.mark(function callee$3$0() {
            var path, key;
            return regeneratorRuntime.wrap(function callee$3$0$(context$4$0) {
              while (1) switch (context$4$0.prev = context$4$0.next) {
                case 0:
                  path = req.path.slice(this._prefix.length - 1);
                  key = this._storeRouter.match(path);

                  _.dev(function () {
                    console.warn("<<< fetch", path);
                  });
                  context$4$0.next = 5;
                  return this.getStore(key);

                case 5: return context$4$0.abrupt("return", context$4$0.sent);
                case 6:
                case "end": return context$4$0.stop();
              }
            }, callee$3$0, this);
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
        }
      },
      _handleHttpPost: {
        writable: true,
        value: function (req, res) {
          co(regeneratorRuntime.mark(function callee$3$0() {
            var path, handler, params;
            return regeneratorRuntime.wrap(function callee$3$0$(context$4$0) {
              while (1) switch (context$4$0.prev = context$4$0.next) {
                case 0:
                  path = req.path.slice(this._prefix.length - 1);
                  handler = this._actionsRouter.match(path);

                  _.dev(function () {
                    return req.body.should.be.an.Object && req.body.guid.should.be.a.String && req.body.params.should.be.ok && _.isPlainObject(req.body.params);
                  });

                  if (_.has(this._sessions, req.body.guid)) {
                    context$4$0.next = 7;
                    break;
                  }

                  this._sessions[guid] = new Session(guid, this._storeEvents, this._eventsEvents, this._sessionsEvents, this.sessionTimeout);
                  context$4$0.next = 7;
                  return this.sessionCreated(guid);

                case 7:
                  params = _.extend({}, { guid: req.body.guid }, req.body.params);

                  _.dev(function () {
                    console.warn("<<< action", path, params);
                  });
                  context$4$0.next = 11;
                  return handler(params);

                case 11: return context$4$0.abrupt("return", context$4$0.sent);
                case 12:
                case "end": return context$4$0.stop();
              }
            }, callee$3$0, this);
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
        }
      },
      _handleSocketConnection: {
        writable: true,
        value: function (socket) {
          var connection = new Connection(this._pid, socket, this._handleSocketDisconnection, this._linkSession, this._unlinkSession);
          this._connections[connection.uniqueId] = connection;
        }
      },
      _handleSocketDisconnection: {
        writable: true,
        value: function (uniqueId) {
          var guid = this._connections[uniqueId].guid;
          if (guid && this._sessions[guid]) {
            this._sessions[guid].detachConnection();
          }
          delete this._connections[uniqueId];
        }
      },
      _linkSession: {
        writable: true,
        value: function (connection, guid) {
          return _.copromise(regeneratorRuntime.mark(function callee$3$0() {
            return regeneratorRuntime.wrap(function callee$3$0$(context$4$0) {
              while (1) switch (context$4$0.prev = context$4$0.next) {
                case 0:

                  if (this._sessions[guid]) {
                    context$4$0.next = 4;
                    break;
                  }

                  this._sessions[guid] = new Session(guid, this._storeEvents, this._eventsEvents, this._sessionsEvents, this.sessionTimeout);
                  context$4$0.next = 4;
                  return this.sessionCreated(guid);

                case 4: return context$4$0.abrupt("return", this._sessions[guid].attachConnection(connection));
                case 5:
                case "end": return context$4$0.stop();
              }
            }, callee$3$0, this);
          }), this);
        }
      },
      _unlinkSession: {
        writable: true,
        value: function (connection, guid) {
          var _this5 = this;

          return function (fn) {
            try {
              if (_this5._sessions[guid]) {
                _this5._sessions[guid].terminate();
              }
            } catch (err) {
              return fn(R.Debug.extendError("R.SimpleUplinkServerInstance._unlinkSession(...)"));
            }
            return fn(null);
          };
        }
      },
      _handleSessionExpire: {
        writable: true,
        value: function (guid) {
          var _this6 = this;

          _.dev(function () {
            return _this6._sessions.guid.should.be.ok;
          });
          delete this._sessions[guid];
          co(regeneratorRuntime.mark(function callee$3$0() {
            return regeneratorRuntime.wrap(function callee$3$0$(context$4$0) {
              while (1) switch (context$4$0.prev = context$4$0.next) {
                case 0:
                  context$4$0.next = 2;
                  return this.sessionDestroyed(guid);

                case 2:
                case "end": return context$4$0.stop();
              }
            }, callee$3$0, this);
          })).call(this, R.Debug.rethrow("R.SimpleUplinkServer._handleSessionExpire(...)"));
        }
      }
    });

    return SimpleUplinkServer;
  })();

  _.extend(UplinkSimpleServer.prototype, /** @lends R.Uplink.prototype */{
    _specs: null,
    _pid: null,
    _prefix: null,
    _app: null,
    _io: null,
    _store: null,
    _hashes: null,
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
    sessionTimeout: null });

  var Connection = (function () {
    var Connection = function Connection(_ref) {
      var pid = _ref.pid;
      var socket = _ref.socket;
      var handleSocketDisconnection = _ref.handleSocketDisconnection;
      var linkSession = _ref.linkSession;
      var unlinkSession = _ref.unlinkSession;

      this._pid = pid;
      this.uniqueId = _.uniqueId("R.SimpleUplinkServer.Connection");
      this._socket = socket;
      this._handleSocketDisconnection = handleSocketDisconnection;
      this._linkSession = linkSession;
      this._unlinkSession = unlinkSession;
      this._bindHandlers();
    };

    _classProps(Connection, null, {
      _bindHandlers: {
        writable: true,
        value: function () {
          this._socket.on("handshake", R.scope(this._handleHandshake, this));
          this._socket.on("subscribeTo", R.scope(this._handleSubscribeTo, this));
          this._socket.on("unsubscribeFrom", R.scope(this._handleUnsubscribeFrom, this));
          this._socket.on("listenTo", R.scope(this._handleListenTo, this));
          this._socket.on("unlistenFrom", R.scope(this._handleUnlistenFrom, this));
          this._socket.on("disconnect", R.scope(this._handleDisconnect, this));
          this._socket.on("unhandshake", R.scope(this._handleUnHandshake, this));
        }
      },
      emit: {
        writable: true,
        value: function (name, params) {
          _.dev(function () {
            console.warn("[C] >>> " + name, params);
          });
          this._socket.emit(name, params);
        }
      },
      _handleHandshake: {
        writable: true,
        value: function (params) {
          if (!params.guid.should.be.ok || !params.guid.should.be.a.String) {
            this.emit("err", { err: "handshake.params.guid: expected String." });
          } else if (this.guid) {
            this.emit("err", { err: "handshake: session already linked." });
          } else {
            co(regeneratorRuntime.mark(function callee$3$0() {
              var s;
              return regeneratorRuntime.wrap(function callee$3$0$(context$4$0) {
                while (1) switch (context$4$0.prev = context$4$0.next) {
                  case 0:

                    this.guid = params.guid;
                    context$4$0.next = 3;
                    return this._linkSession(this, this.guid);

                  case 3:
                    s = context$4$0.sent;

                    this.emit("handshake-ack", {
                      pid: this._pid,
                      recovered: s.recovered });
                    this._subscribeTo = s.subscribeTo;
                    this._unsubscribeFrom = s.unsubscribeFrom;
                    this._listenTo = s.listenTo;
                    this._unlistenFrom = s.unlistenFrom;

                  case 9:
                  case "end": return context$4$0.stop();
                }
              }, callee$3$0, this);
            })).call(this, R.Debug.rethrow("R.SimpleUplinkServer.Connection._handleHandshake(...)"));
          }
        }
      },
      _handleUnHandshake: {
        writable: true,
        value: function () {
          if (!this.guid) {
            this.emit("err", { err: "unhandshake: no active session." });
          } else {
            co(regeneratorRuntime.mark(function callee$3$0() {
              var s;
              return regeneratorRuntime.wrap(function callee$3$0$(context$4$0) {
                while (1) switch (context$4$0.prev = context$4$0.next) {
                  case 0:

                    this._subscribeTo = null;
                    this._unsubscribeFrom = null;
                    this._listenTo = null;
                    this._unlistenFrom = null;
                    context$4$0.next = 6;
                    return this._unlinkSession(this, this.guid);

                  case 6:
                    s = context$4$0.sent;

                    this.emit("unhandshake-ack");
                    this.guid = null;

                  case 9:
                  case "end": return context$4$0.stop();
                }
              }, callee$3$0, this);
            })).call(this, R.Debug.rethrow("R.SimpleUplinkServer.Connection._handleUnHandshake(...)"));
          }
        }
      },
      _handleSubscribeTo: {
        writable: true,
        value: function (params) {
          if (!params.key.should.be.ok || !params.key.should.be.a.String) {
            this.emit("err", { err: "subscribeTo.params.key: expected String." });
          } else if (!this._subscribeTo) {
            this.emit("err", { err: "subscribeTo: requires handshake." });
          } else {
            this._subscribeTo(params.key);
          }
        }
      },
      _handleUnsubscribeFrom: {
        writable: true,
        value: function (params) {
          if (!params.key.should.be.ok || !params.key.should.be.a.String) {
            this.emit("err", { err: "unsubscribeFrom.params.key: expected String." });
          } else if (!this._unsubscribeFrom) {
            this.emit("err", { err: "unsubscribeFrom: requires handshake." });
          } else {
            this._unsubscribeFrom(params.key);
          }
        }
      },
      _handleListenTo: {
        writable: true,
        value: function (params) {
          if (!params.eventName.should.be.ok || !params.eventName.should.be.a.String) {
            this.emit("err", { err: "listenTo.params.eventName: expected String." });
          } else if (!this._listenTo) {
            this.emit("err", { err: "listenTo: requires handshake." });
          } else {
            this.listenTo(params.eventName);
          }
        }
      },
      _handleUnlistenFrom: {
        writable: true,
        value: function (params) {
          if (!params.eventName.should.be.ok || !params.eventName.should.be.a.String) {
            this.emit("err", { err: "unlistenFrom.params.eventName: expected String." });
          } else if (!this.unlistenFrom) {
            this._emit("err", { err: "unlistenFrom: requires handshake." });
          } else {
            this.unlistenFrom(params.eventName);
          }
        }
      },
      _handleDisconnect: {
        writable: true,
        value: function () {
          this._handleSocketDisconnection(this.uniqueId, false);
        }
      }
    });

    return Connection;
  })();

  _.extend(Connection.prototype, /** @lends R.Uplink.prototype */{
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
    _disconnected: null });

  var Session = (function () {
    var Session = function Session(_ref2) {
      var guid = _ref2.guid;
      var storeEvents = _ref2.storeEvents;
      var eventsEvents = _ref2.eventsEvents;
      var sessionsEvents = _ref2.sessionsEvents;
      var timeout = _ref2.timeout;

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
    };

    _classProps(Session, null, {
      attachConnection: {
        writable: true,
        value: function (connection) {
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
        }
      },
      detachConnection: {
        writable: true,
        value: function () {
          if (this._connection === null) {
            return;
          } else {
            this._connection = null;
            this._messageQueue = [];
            this._expireTimeout = setTimeout(this._expire, this._timeoutDuration);
          }
        }
      },
      terminate: {
        writable: true,
        value: function () {
          this._expire();
        }
      },
      subscribeTo: {
        writable: true,
        value: function (key) {
          var _this7 = this;

          _.dev(function () {
            return _this7._subscriptions.key.should.be.ok;
          });
          this._subscriptions[key] = this._signalUpdate();
          this._storeEvents.addListener("set:" + key, this._subscriptions[key]);
        }
      },
      uunsubscribeFrom: {
        writable: true,
        value: function (key) {
          var _this8 = this;

          _.dev(function () {
            return _this8._subscriptions.key.should.be.ok;
          });
          this._storeEvents.removeListener("set:" + key, this._subscriptions[key]);
          delete this._subscriptions[key];
        }
      },
      _emit: {
        writable: true,
        value: function (name, params) {
          _.dev(function () {
            console.warn("[S] >>> " + name, params);
          });
          if (this._connection !== null) {
            this._connection.emit(name, params);
          } else {
            this._messageQueue.push({
              name: name,
              params: params });
          }
        }
      },
      _signalUpdate: {
        writable: true,
        value: function () {
          var _this9 = this;

          return function (patch) {
            _this9._emit("update", patch);
          };
        }
      },
      _signalEvent: {
        writable: true,
        value: function (eventName) {
          var _this10 = this;

          return function (params) {
            _this10._emit("event", { eventName: eventName, params: params });
          };
        }
      },
      _expire: {
        writable: true,
        value: function () {
          Object.keys(this._subscriptions).forEach(R.scope(this.unsubscribeFrom, this));
          Object.keys(this._listeners).forEach(R.scope(this.unlistenFrom, this));
          this._sessionsEvents.emit("expire", this._guid);
        }
      },
      listenTo: {
        writable: true,
        value: function (eventName) {
          var _this11 = this;

          _.dev(function () {
            return _this11._listeners.key.should.be.ok;
          });
          this._listeners[eventName] = this._signalEvent(eventName);
          this._eventsEvents.addListener("emit:" + eventName, this._listeners[eventName]);
        }
      },
      unlistenFrom: {
        writable: true,
        value: function (eventName) {
          var _this12 = this;

          _.dev(function () {
            return _this12._listeners.eventName.should.be.ok;
          });
          this._eventsEvents.removeListener("emit:" + eventName, this._listeners[eventName]);
          delete this._listeners[eventName];
        }
      }
    });

    return Session;
  })();

  _.extend(Session.prototype, /** @lends R.Uplink.prototype */{
    _guid: null,
    _connection: null,
    _subscriptions: null,
    _listeners: null,
    _storeEvents: null,
    _eventsEvents: null,
    _sessionsEvents: null,
    _messageQueue: null,
    _expireTimeout: null,
    _timeoutDuration: null });

  return SimpleUplinkServer;
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImQ6L1Byb2pldHMvbWlsbGVuaXVtX3NjaG9vbC9uZXh1cy11cGxpbmstc2ltcGxlLXNlcnZlci9uZXh1cy11cGxpbmstc2ltcGxlLXNlcnZlci9zcmMvaW5kZXguanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7QUFBQSxPQUFPLENBQUMsZUFBZSxDQUFDLENBQUM7QUFDekIsSUFBSSxPQUFPLEdBQUcsT0FBTyxDQUFDLFVBQVUsQ0FBQyxDQUFDO0FBQ2xDLE1BQU0sQ0FBQyxPQUFPLEdBQUcsVUFBUyxDQUFDLEVBQUU7QUFDekIsTUFBTSxFQUFFLEdBQUcsT0FBTyxDQUFDLFdBQVcsQ0FBQyxDQUFDO0FBQ2hDLE1BQU0sQ0FBQyxHQUFHLE9BQU8sQ0FBQyxRQUFRLENBQUMsQ0FBQztBQUM1QixNQUFNLEVBQUUsR0FBRyxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUM7QUFDekIsTUFBTSxZQUFZLEdBQUcsT0FBTyxDQUFDLFFBQVEsQ0FBQyxDQUFDLFlBQVksQ0FBQztBQUNwRCxNQUFNLFVBQVUsR0FBRyxPQUFPLENBQUMsYUFBYSxDQUFDLENBQUM7O01BUXBDLGtCQUFrQjtRQUFsQixrQkFBa0IsR0FTVCxTQVRULGtCQUFrQixDQVNSLEtBQUssRUFBQztBQUNoQixPQUFDLENBQUMsR0FBRyxDQUFDO2VBQ0osS0FBSyxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxLQUFLLElBQzlCLEtBQUssQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsS0FBSyxJQUMvQixLQUFLLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUMsRUFBRSxJQUFJLENBQUMsQ0FBQyxhQUFhLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxJQUMzRCxLQUFLLENBQUMsY0FBYyxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLFFBQVEsSUFDekMsS0FBSyxDQUFDLGNBQWMsQ0FBQyxN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QUFJO0FBQ2pCLGtCQUFjLEVBQUUsSUFBSTtBQUNwQixjQUFVLEVBQUUsSUFBSTtBQUNoQixnQkFBWSxFQUFFLElBQUk7QUFDbEIsaUJBQWEsRUFBRSxJQUFJO0FBQ25CLG1CQUFlLEVBQUUsSUFBSTtBQUNyQixpQkFBYSxFQUFFLElBQUk7QUFDbkIsa0JBQWMsRUFBRSxJQUFJO0FBQ3BCLG9CQUFnQixFQUFFLElBQUksRUFDekIsQ0FBQyxDQUFDOztBQUVQLFNBQU8sa0JBQWtCLENBQUM7Q0FDN0IsQ0FBQyIsImZpbGUiOiJpbmRleC5qcyIsInNvdXJjZXNDb250ZW50IjpbInJlcXVpcmUoJzZ0bzUvcG9seWZpbGwnKTtcbnZhciBQcm9taXNlID0gcmVxdWlyZSgnYmx1ZWJpcmQnKTtcbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oUikge1xyXG4gICAgY29uc3QgaW8gPSByZXF1aXJlKCdzb2NrZXQuaW8nKTtcclxuICAgIGNvbnN0IF8gPSByZXF1aXJlKCdsb2Rhc2gnKTtcclxuICAgIGNvbnN0IGNvID0gcmVxdWlyZSgnY28nKTtcclxuICAgIGNvbnN0IEV2ZW50RW1pdHRlciA9IHJlcXVpcmUoJ2V2ZW50cycpLkV2ZW50RW1pdHRlcjtcclxuICAgIGNvbnN0IGJvZHlQYXJzZXIgPSByZXF1aXJlKCdib2R5LXBhcnNlcicpO1xyXG5cclxuICAgIC8qKlxyXG4gICAgKiA8cD4gU2ltcGxlVXBsaW5rU2VydmVyIHJlcHJlc2VudHMgYW4gdXBsaW5rLXNlcnZlciB0aGF0IHdpbGwgYmUgYWJsZSB0byBzdG9yZSBkYXRhIHZpYSBhbiBvdGhlciBzZXJ2ZXIuPGJyIC8+XHJcbiAgICAqIFRoZXJlIGFsc28gd2lsbCBiZSBhYmxlIHRvIG5vdGlmeSBlYWNoIGNsaWVudCB3aG8gc3VzY3JpYmVzIHRvIGEgZGF0YSB3aGVuIGFuIHVwZGF0ZSB3aWxsIG9jY3VycyB0aGFua3MgdG8gc29ja2V0IDwvcD5cclxuICAgICogPHA+IFNpbXBsZVVwbGlua1NlcnZlciB3aWxsIGJlIHJlcXVlc3RlZCBieSBHRVQgb3IgUE9TVCB2aWEgUi5VcGxpbmsgc2VydmVyLXNpZGUgYW5kIGNsaWVudC1zaWRlXHJcbiAgICAqIEBjbGFzcyBSLlNpbXBsZVVwbGlua1NlcnZlclxyXG4gICAgKi9cclxuICAgIGNsYXNzIFNpbXBsZVVwbGlua1NlcnZlciB7XHJcbiAgICAgICAgLyoqXHJcbiAgICAgICAgKiA8cD4gSW5pdGlhbGl6ZXMgdGhlIFNpbXBsZVVwbGlua1NlcnZlciBhY2NvcmRpbmcgdG8gdGhlIHNwZWNpZmljYXRpb25zIHByb3ZpZGVkIDwvcD5cclxuICAgICAgICAqIEBtZXRob2QgY3JlYXRlQXBwXHJcbiAgICAgICAgKiBAcGFyYW0ge29iamVjdH0gc3BlY3MgQWxsIHRoZSBzcGVjaWZpY2F0aW9ucyBvZiB0aGUgU2ltcGxlVXBsaW5rU2VydmVyXHJcbiAgICAgICAgKiBAcmV0dXJuIHtTaW1wbGVVcGxpbmtTZXJ2ZXJJbnN0YW5jZX0gU2ltcGxlVXBsaW5rU2VydmVySW5zdGFuY2UgVGhlIGluc3RhbmNlIG9mIHRoZSBjcmVhdGVkIFNpbXBsZVVwbGlua1NlcnZlclxyXG4gICAgICAgICovXHJcblxyXG5cclxuICAgICAgICBjb25zdHJ1Y3RvcihzcGVjcyl7XHJcbiAgICAgICAgICBfLmRldigoKSA9PiBcclxuICAgICAgICAgICAgc3BlY3Muc3RvcmUuc2hvdWxkLmJlLmFuLkFycmF5ICYmXHJcbiAgICAgICAgICAgIHNwZWNzLmV2ZW50cy5zaG91bGQuYmUuYW4uQXJyYXkgJiZcclxuICAgICAgICAgICAgc3BlY3MuYWN0aW9uLnNob3VsZC5iZS5vayAmJiBfLmlzUGxhaW5PYmplY3Qoc3BlY3MuYWN0aW9ucykgJiZcclxuICAgICAgICAgICAgc3BlY3Muc2Vzc2lvbkNyZWF0ZWQuc2hvdWxkLmJlLmEuRnVuY3Rpb24gJiZcclxuICAgICAgICAgICAgc3BlY3Muc2Vzc2lvblRpbWVvdXQuc2hvdWxkLmJlLmEuTnVtYmVyXHJcbiAgICAgICAgICApO1xyXG5cclxuICAgICAgICAgIHRoaXMuX3NwZWNzID0gc3BlY3M7XHJcbiAgICAgICAgICB0aGlzLl9waWQgPSBSLmd1aWQoJ1NpbXBsZVVwbGlua1NlcnZlcicpO1xyXG4gICAgICAgICAgdGhpcy5fc3RvcmUgPSB7fTtcclxuICAgICAgICAgIHRoaXMuX2hhc2hlcyA9IHt9O1xyXG4gICAgICAgICAgdGhpcy5fc3RvcmVSb3V0ZXIgPSBuZXcgUi5Sb3V0ZXIoKTtcclxuICAgICAgICAgIHRoaXMuX3N0b3JlUm91dGVyLmRlZihfLmNvbnN0YW50KHtcclxuICAgICAgICAgICAgZXJyOiAnVW5rbm93biBzdG9yZSBrZXknLFxyXG4gICAgICAgICAgfSkpO1xyXG4gICAgICAgICAgdGhpcy5fc3RvcmVFdmVudHMgPSBuZXcgRXZlbnRFbWl0dGVyKCk7XHJcbiAgICAgICAgICB0aGlzLl9ldmVudHNSb3V0ZXIgPSBuZXcgUi5Sb3V0ZXIoKTtcclxuICAgICAgICAgIHRoaXMuX2V2ZW50c1JvdXRlci5kZWYoXy5jb25zdGFudCh7XHJcbiAgICAgICAgICAgIGVycjogJ1Vua25vd24gZXZlbnQgbmFtZScsXHJcbiAgICAgICAgICB9KSk7XHJcbiAgICAgICAgICB0aGlzLl9ldmVudHNFdmVudHMgPSBuZXcgRXZlbnRFbWl0dGVyKCk7XHJcbiAgICAgICAgICB0aGlzLl9hY3Rpb25zUm91dGVyID0gbmV3IFIuUm91dGVyKCk7XHJcbiAgICAgICAgICB0aGlzLl9hY3Rpb25zUm91dGVyLmRlZihfLmNvbnN0YW50KHtcclxuICAgICAgICAgICAgZXJyOiAnVW5rbm93biBhY3Rpb24nLFxyXG4gICAgICAgICAgfSkpO1xyXG4gICAgICAgICAgdGhpcy5fc2Vzc2lvbnMgPSB7fTtcclxuICAgICAgICAgIHRoaXMuX3Nlc3Npb25zRXZlbnRzID0gbmV3IEV2ZW50RW1pdHRlcigpO1xyXG4gICAgICAgICAgdGhpcy5fY29ubmVjdGlvbnMgPSB7fTtcclxuXHJcbiAgICAgICAgICB0aGlzLl9saW5rU2Vzc2lvbiA9IFIuc2NvcGUodGhpcy5fbGlua1Nlc3Npb24sIHRoaXMpO1xyXG4gICAgICAgICAgdGhpcy5fdW5saW5rU2Vzc2lvbiA9IFIuc2NvcGUodGhpcy5fdW5saW5rU2Vzc2lvbiwgdGhpcyk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvKipcclxuICAgICAgICAqIDxwPlNhdmVzIGRhdGEgaW4gc3RvcmUuXHJcbiAgICAgICAgKiBDYWxsZWQgYnkgYW5vdGhlciBzZXJ2ZXIgdGhhdCB3aWxsIHByb3ZpZGUgZGF0YSBmb3IgZWFjaCB1cGRhdGVkIGRhdGEgPC9wPlxyXG4gICAgICAgICogQG1ldGhvZCBzZXRTdG9yZVxyXG4gICAgICAgICogQHBhcmFtIHtzdHJpbmd9IGtleSBUaGUgc3BlY2lmaWVkIGtleSB0byBzZXRcclxuICAgICAgICAqIEBwYXJhbSB7c3RyaW5nfSB2YWwgVGhlIHZhbHVlIHRvIHNhdmVcclxuICAgICAgICAqIEByZXR1cm4ge2Z1bmN0aW9ufSBcclxuICAgICAgICAqL1xyXG4gICAgICAgIHNldFN0b3JlKGtleSwgdmFsKSB7XHJcbiAgICAgICAgICAgIHJldHVybiAoZm4pID0+IHtcclxuICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgbGV0IHByZXZpb3VzVmFsID0gdGhpcy5fc3RvcmVba2V5XSB8fCB7fTtcclxuICAgICAgICAgICAgICAgICAgICBsZXQgcHJldmlvdXNIYXNoID0gdGhpcy5faGFzaGVzW2tleV0gfHwgUi5oYXNoKEpTT04uc3RyaW5naWZ5KHByZXZpb3VzVmFsKSk7XHJcbiAgICAgICAgICAgICAgICAgICAgbGV0IGRpZmYgPSBSLmRpZmYocHJldmlvdXNWYWwsIHZhbCk7XHJcbiAgICAgICAgICAgICAgICAgICAgbGV0IGhhc2ggPSBSLmhhc2goSlNPTi5zdHJpbmdpZnkodmFsKSk7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fc3RvcmVba2V5XSA9IHZhbDtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLl9oYXNoZXNba2V5XSA9IGhhc2g7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fc3RvcmVFdmVudHMuZW1pdCgnc2V0OicgKyBrZXksIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgazoga2V5LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBkOiBkaWZmLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBoOiBwcmV2aW91c0hhc2gsXHJcbiAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBjYXRjaChlcnIpIHtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gZm4oUi5EZWJ1Zy5leHRlbmRFcnJvcihlcnIsICdSLlNpbXBsZVVwbGlua1NlcnZlci5zZXRTdG9yZShcXCcnICsga2V5ICsgJ1xcJywgXFwnJyArIHZhbCArICdcXCcpJykpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgXy5kZWZlcigoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgZm4obnVsbCwgdmFsKTtcclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLyoqXHJcbiAgICAgICAgKiA8cD4gUHJvdmlkZXMgZGF0YSBmcm9tIHN0b3JlLiA8YnIgLz5cclxuICAgICAgICAqIENhbGxlZCB3aGVuIHRoZSBmZXRjaGluZyBkYXRhIG9jY3Vycy4gPGJyIC8+XHJcbiAgICAgICAgKiBSZXF1ZXN0ZWQgYnkgR0VUIGZyb20gUi5TdG9yZSBzZXJ2ZXItc2lkZSBvciBjbGllbnQtc2lkZTwvcD5cclxuICAgICAgICAqIEBtZXRob2QgZ2V0U3RvcmVcclxuICAgICAgICAqIEBwYXJhbSB7c3RyaW5nfSBrZXkgVGhlIHNwZWNpZmllZCBrZXkgdG8gc2V0XHJcbiAgICAgICAgKiBAcmV0dXJuIHtmdW5jdGlvbn0gXHJcbiAgICAgICAgKi9cclxuICAgICAgICBnZXRTdG9yZShrZXkpIHtcclxuICAgICAgICAgICAgcmV0dXJuIChmbikgPT4ge1xyXG4gICAgICAgICAgICAgICAgbGV0IHZhbDtcclxuICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgXy5kZXYoKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZighXy5oYXModGhpcy5fc3RvcmUsIGtleSkpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUud2FybignUi5TaW1wbGVVcGxpbmtTZXJ2ZXIoLi4uKS5nZXRTdG9yZTogbm8gc3VjaCBrZXkgKCcgKyBrZXkgKyAnKScpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgdmFsID0gdGhpcy5fc3RvcmVba2V5XTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGNhdGNoKGVycikge1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBmbihSLkRlYnVnLmV4dGVuZEVycm9yKGVyciwgJ1IuU2ltcGxlVXBsaW5rU2VydmVyLmdldFN0b3JlKFxcJycgKyBrZXkgKyAnXFwnKScpKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIF8uZGVmZXIoKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIGZuKG51bGwsIHZhbCk7XHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICB9XHJcbiAgICAgICAgLyoqXHJcbiAgICAgICAgKiBAbWV0aG9kIGVtaXRFdmVudFxyXG4gICAgICAgICogQHBhcmFtIHtzdHJpbmd9IGV2ZW50TmFtZVxyXG4gICAgICAgICogQHBhcmFtIHtvYmplY3R9IHBhcmFtc1xyXG4gICAgICAgICovXHJcbiAgICAgICAgZW1pdEV2ZW50KGV2ZW50TmFtZSwgcGFyYW1zKSB7XHJcbiAgICAgICAgICAgIHRoaXMuX2V2ZW50c0V2ZW50cy5lbWl0KCdlbWl0OicgKyBldmVudE5hbWUsIHBhcmFtcyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIC8qKlxyXG4gICAgICAgICogQG1ldGhvZCBlbWl0RGVidWdcclxuICAgICAgICAqIEBwYXJhbSB7c3RyaW5nfSBndWlkXHJcbiAgICAgICAgKiBAcGFyYW0ge29iamVjdH0gcGFyYW1zXHJcbiAgICAgICAgKi9cclxuICAgICAgICBlbWl0RGVidWcoZ3VpZCwgcGFyYW1zKSB7XHJcbiAgICAgICAgICAgIF8uZGV2KCgpID0+IHtcclxuICAgICAgICAgICAgICAgIGlmKHRoaXMuX3Nlc3Npb25zW2d1aWRdKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2Vzc2lvbnNbZ3VpZF0uZW1pdCgnZGVidWcnLCBwYXJhbXMpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9XHJcbiAgICAgICAgLyoqXHJcbiAgICAgICAgKiBAbWV0aG9kIGVtaXRMb2dcclxuICAgICAgICAqIEBwYXJhbSB7c3RyaW5nfSBndWlkXHJcbiAgICAgICAgKiBAcGFyYW0ge29iamVjdH0gcGFyYW1zXHJcbiAgICAgICAgKi9cclxuICAgICAgICBlbWl0TG9nKGd1aWQsIHBhcmFtcykge1xyXG4gICAgICAgICAgICBpZih0aGlzLl9zZXNzaW9uc1tndWlkXSkge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fc2Vzc2lvbnNbZ3VpZF0uZW1pdCgnbG9nJywgcGFyYW1zKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICAvKipcclxuICAgICAgICAqIEBtZXRob2QgZW1pdFdhcm5cclxuICAgICAgICAqIEBwYXJhbSB7c3RyaW5nfSBndWlkXHJcbiAgICAgICAgKiBAcGFyYW0ge29iamVjdH0gcGFyYW1zXHJcbiAgICAgICAgKi9cclxuICAgICAgICBlbWl0V2FybihndWlkLCBwYXJhbXMpIHtcclxuICAgICAgICAgICAgaWYodGhpcy5fc2Vzc2lvbnNbZ3VpZF0pIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuX3Nlc3Npb25zW2d1aWRdLmVtaXQoJ3dhcm4nLCBwYXJhbXMpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIC8qKlxyXG4gICAgICAgICogQG1ldGhvZCBlbWl0RXJyb3JcclxuICAgICAgICAqIEBwYXJhbSB7c3RyaW5nfSBndWlkXHJcbiAgICAgICAgKiBAcGFyYW0ge29iamVjdH0gcGFyYW1zXHJcbiAgICAgICAgKi8gICAgICAgICAgICBcclxuICAgICAgICBlbWl0RXJyb3IoZ3VpZCwgcGFyYW1zKSB7XHJcbiAgICAgICAgICAgIGlmKHRoaXMuX3Nlc3Npb25zW2d1aWRdKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9zZXNzaW9uc1tndWlkXS5lbWl0KCdlcnInLCBwYXJhbXMpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIF9leHRyYWN0T3JpZ2luYWxQYXRoKCkge1xyXG4gICAgICAgICAgICByZXR1cm4gYXJndW1lbnRzW2FyZ3VtZW50cy5sZW5ndGggLSAxXTtcclxuICAgICAgICB9XHJcbiAgICAgICAgX2JpbmRTdG9yZVJvdXRlKHJvdXRlKSB7XHJcbiAgICAgICAgICAgIHRoaXMuX3N0b3JlUm91dGVyLnJvdXRlKHJvdXRlLCB0aGlzLl9leHRyYWN0T3JpZ2luYWxQYXRoKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgIF9iaW5kRXZlbnRzUm91dGUocm91dGUpIHtcclxuICAgICAgICAgICAgdGhpcy5fZXZlbnRzUm91dGVyLnJvdXRlKHJvdXRlLCB0aGlzLl9leHRyYWN0T3JpZ2luYWxQYXRoKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgX2JpbmRBY3Rpb25zUm91dGUoaGFuZGxlciwgcm91dGUpIHtcclxuICAgICAgICAgICAgdGhpcy5fYWN0aW9uc1JvdXRlci5yb3V0ZShyb3V0ZSwgXy5jb25zdGFudChSLnNjb3BlKGhhbmRsZXIsIHRoaXMpKSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIC8qKiBcclxuICAgICAgICAqIDxwPiBTZXR0aW5nIHVwIFVwbGlua1NlcnZlci4gPGJyIC8+XHJcbiAgICAgICAgKiAtIGNyZWF0ZSB0aGUgc29ja2V0IGNvbm5lY3Rpb24gPGJyIC8+XHJcbiAgICAgICAgKiAtIGluaXQgZ2V0IGFuZCBwb3N0IGFwcCBpbiBvcmRlciB0byBwcm92aWRlIGRhdGEgdmlhIFIuVXBsaW5rLmZldGNoPC9wPlxyXG4gICAgICAgICogQG1ldGhvZCBpbnN0YWxsSGFuZGxlcnNcclxuICAgICAgICAqIEBwYXJhbSB7b2JqZWN0fSBhcHAgVGhlIHNwZWNpZmllZCBBcHBcclxuICAgICAgICAqIEBwYXJhbSB7c3RyaW5nfSBwcmVmaXggVGhlIHByZWZpeCBzdHJpbmcgdGhhdCB3aWxsIGJlIHJlcXVlc3RlZC4gVGlwaWNhbGx5IFwiL3VwbGlua1wiXHJcbiAgICAgICAgKi9cclxuICAgICAgICBpbnN0YWxsSGFuZGxlcnMoYXBwLCBwcmVmaXgpIHtcclxuICAgICAgICAgICAgcmV0dXJuIF8uY29wcm9taXNlKGZ1bmN0aW9uKigpIHtcclxuICAgICAgICAgICAgICAgIF8uZGV2KCgpID0+ICh0aGlzLl9hcHAgPT09IG51bGwpLnNob3VsZC5iZS5vayk7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9hcHAgPSBhcHA7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9wcmVmaXggPSBwcmVmaXggfHwgJy91cGxpbmsvJztcclxuICAgICAgICAgICAgICAgIGxldCBzZXJ2ZXIgPSByZXF1aXJlKCdodHRwJykuU2VydmVyKGFwcCk7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9pbyA9IGlvKHNlcnZlcikub2YocHJlZml4KTtcclxuICAgICAgICAgICAgICAgIHRoaXMuX2FwcC5nZXQodGhpcy5fcHJlZml4ICsgJyonLCBSLnNjb3BlKHRoaXMuX2hhbmRsZUh0dHBHZXQsIHRoaXMpKTtcclxuICAgICAgICAgICAgICAgIHRoaXMuX2FwcC5wb3N0KHRoaXMuX3ByZWZpeCArICcqJywgYm9keVBhcnNlci5qc29uKCksIFIuc2NvcGUodGhpcy5faGFuZGxlSHR0cFBvc3QsIHRoaXMpKTtcclxuICAgICAgICAgICAgICAgIHRoaXMuX2lvLm9uKCdjb25uZWN0aW9uJywgUi5zY29wZSh0aGlzLl9oYW5kbGVTb2NrZXRDb25uZWN0aW9uLCB0aGlzKSk7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9oYW5kbGVTb2NrZXREaXNjb25uZWN0aW9uID0gUi5zY29wZSh0aGlzLl9oYW5kbGVTb2NrZXREaXNjb25uZWN0aW9uLCB0aGlzKTtcclxuICAgICAgICAgICAgICAgIHRoaXMuX3Nlc3Npb25zRXZlbnRzLmFkZExpc3RlbmVyKCdleHBpcmUnLCBSLnNjb3BlKHRoaXMuX2hhbmRsZVNlc3Npb25FeHBpcmUsIHRoaXMpKTtcclxuICAgICAgICAgICAgICAgIF8uZWFjaCh0aGlzLl9zcGVjcy5zdG9yZSwgUi5zY29wZSh0aGlzLl9iaW5kU3RvcmVSb3V0ZSwgdGhpcykpO1xyXG4gICAgICAgICAgICAgICAgXy5lYWNoKHRoaXMuX3NwZWNzLmV2ZW50cywgUi5zY29wZSh0aGlzLl9iaW5kRXZlbnRzUm91dGUsIHRoaXMpKTtcclxuICAgICAgICAgICAgICAgIF8uZWFjaCh0aGlzLl9zcGVjcy5hY3Rpb25zLCBSLnNjb3BlKHRoaXMuX2JpbmRBY3Rpb25zUm91dGUsIHRoaXMpKTtcclxuICAgICAgICAgICAgICAgIHRoaXMuYm9vdHN0cmFwID0gUi5zY29wZSh0aGlzLl9zcGVjcy5ib290c3RyYXAsIHRoaXMpO1xyXG4gICAgICAgICAgICAgICAgeWllbGQgdGhpcy5ib290c3RyYXAoKTtcclxuICAgICAgICAgICAgICAgIHJldHVybiBzZXJ2ZXI7XHJcbiAgICAgICAgICAgIH0sIHRoaXMpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLyoqXHJcbiAgICAgICAgKiA8cD5SZXR1cm4gdGhlIHNhdmVkIGRhdGEgZnJvbSBzdG9yZTwvcD5cclxuICAgICAgICAqIDxwPlJlcXVlc3RlZCBmcm9tIFIuU3RvcmUgc2VydmVyLXNpZGUgb3IgY2xpZW50LXNpZGU8L3A+XHJcbiAgICAgICAgKiBAbWV0aG9kIF9oYW5kbGVIdHRwR2V0XHJcbiAgICAgICAgKiBAcGFyYW0ge29iamVjdH0gcmVxIFRoZSBjbGFzc2ljYWwgcmVxdWVzdFxyXG4gICAgICAgICogQHBhcmFtIHtvYmplY3R9IHJlcyBUaGUgcmVzcG9uc2UgdG8gc2VuZFxyXG4gICAgICAgICogQHBhcmFtIHtvYmplY3R9IG5leHRcclxuICAgICAgICAqIEByZXR1cm4ge3N0cmluZ30gdmFsIFRoZSBjb21wdXRlZCBqc29uIHZhbHVlXHJcbiAgICAgICAgKi9cclxuICAgICAgICBfaGFuZGxlSHR0cEdldChyZXEsIHJlcywgbmV4dCkge1xyXG4gICAgICAgICAgICBjbyhmdW5jdGlvbiooKSB7XHJcbiAgICAgICAgICAgICAgICBsZXQgcGF0aCA9IHJlcS5wYXRoLnNsaWNlKHRoaXMuX3ByZWZpeC5sZW5ndGggLSAxKTsgLy8ga2VlcCB0aGUgbGVhZGluZyBzbGFzaFxyXG4gICAgICAgICAgICAgICAgbGV0IGtleSA9IHRoaXMuX3N0b3JlUm91dGVyLm1hdGNoKHBhdGgpO1xyXG4gICAgICAgICAgICAgICAgXy5kZXYoKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUud2FybignPDw8IGZldGNoJywgcGF0aCk7XHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgIHJldHVybiB5aWVsZCB0aGlzLmdldFN0b3JlKGtleSk7XHJcbiAgICAgICAgICAgIH0pLmNhbGwodGhpcywgKGVyciwgdmFsKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBpZihlcnIpIHtcclxuICAgICAgICAgICAgICAgICAgICBpZihSLkRlYnVnLmlzRGV2KCkpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoNTAwKS5qc29uKHsgZXJyOiBlcnIudG9TdHJpbmcoKSwgc3RhY2s6IGVyci5zdGFjayB9KTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiByZXMuc3RhdHVzKDUwMCkuanNvbih7IGVycjogZXJyLnRvU3RyaW5nKCkgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoMjAwKS5qc29uKHZhbCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLyoqXHJcbiAgICAgICAgKiBAbWV0aG9kIF9oYW5kbGVIdHRwUG9zdFxyXG4gICAgICAgICogQHBhcmFtIHtvYmplY3R9IHJlcSBUaGUgY2xhc3NpY2FsIHJlcXVlc3RcclxuICAgICAgICAqIEBwYXJhbSB7b2JqZWN0fSByZXMgVGhlIHJlc3BvbnNlIHRvIHNlbmRcclxuICAgICAgICAqIEByZXR1cm4ge3N0cmluZ30gc3RyXHJcbiAgICAgICAgKi9cclxuICAgICAgICBfaGFuZGxlSHR0cFBvc3QocmVxLCByZXMpIHtcclxuICAgICAgICAgICAgY28oZnVuY3Rpb24qKCkge1xyXG4gICAgICAgICAgICAgICAgbGV0IHBhdGggPSByZXEucGF0aC5zbGljZSh0aGlzLl9wcmVmaXgubGVuZ3RoIC0gMSk7IC8vIGtlZXAgdGhlIGxlYWRpbmcgc2xhc2hcclxuICAgICAgICAgICAgICAgIGxldCBoYW5kbGVyID0gdGhpcy5fYWN0aW9uc1JvdXRlci5tYXRjaChwYXRoKTtcclxuICAgICAgICAgICAgICAgIF8uZGV2KCgpID0+IFxyXG4gICAgICAgICAgICAgICAgICAgIHJlcS5ib2R5LnNob3VsZC5iZS5hbi5PYmplY3QgJiZcclxuICAgICAgICAgICAgICAgICAgICByZXEuYm9keS5ndWlkLnNob3VsZC5iZS5hLlN0cmluZyAmJlxyXG4gICAgICAgICAgICAgICAgICAgIHJlcS5ib2R5LnBhcmFtcy5zaG91bGQuYmUub2sgJiYgXy5pc1BsYWluT2JqZWN0KHJlcS5ib2R5LnBhcmFtcylcclxuICAgICAgICAgICAgICAgICk7XHJcbiAgICAgICAgICAgICAgICBpZighXy5oYXModGhpcy5fc2Vzc2lvbnMsIHJlcS5ib2R5Lmd1aWQpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fc2Vzc2lvbnNbZ3VpZF0gPSBuZXcgU2Vzc2lvbihndWlkLCB0aGlzLl9zdG9yZUV2ZW50cywgdGhpcy5fZXZlbnRzRXZlbnRzLCB0aGlzLl9zZXNzaW9uc0V2ZW50cywgdGhpcy5zZXNzaW9uVGltZW91dCk7XHJcbiAgICAgICAgICAgICAgICAgICAgeWllbGQgdGhpcy5zZXNzaW9uQ3JlYXRlZChndWlkKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGxldCBwYXJhbXMgPSBfLmV4dGVuZCh7fSwgeyBndWlkOiByZXEuYm9keS5ndWlkIH0sIHJlcS5ib2R5LnBhcmFtcyk7XHJcbiAgICAgICAgICAgICAgICBfLmRldigoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS53YXJuKCc8PDwgYWN0aW9uJywgcGF0aCwgcGFyYW1zKTtcclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHlpZWxkIGhhbmRsZXIocGFyYW1zKTtcclxuICAgICAgICAgICAgfSkuY2FsbCh0aGlzLCAoZXJyLCB2YWwpID0+IHtcclxuICAgICAgICAgICAgICAgIGlmKGVycikge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmKFIuRGVidWcuaXNEZXYoKSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gcmVzLnN0YXR1cyg1MDApLmpzb24oeyBlcnI6IGVyci50b1N0cmluZygpLCBzdGFjazogZXJyLnN0YWNrIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoNTAwKS5qc29uKHsgZXJyOiBlcnIudG9TdHJpbmcoKSB9KTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICByZXMuc3RhdHVzKDIwMCkuanNvbih2YWwpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8qKiBcclxuICAgICAgICAqIDxwPiBDcmVhdGUgYSBSLlNpbXBsZVVwbGlua1NlcnZlci5Db25uZWN0aW9uIGluIG9yZGVyIHRvIHNldCB1cCBoYW5kbGVyIGl0ZW1zLiA8YnIgLz5cclxuICAgICAgICAqIFRyaWdnZXJlZCB3aGVuIGEgc29ja2V0IGNvbm5lY3Rpb24gaXMgZXN0YWJsaXNoZWQgPC9wPlxyXG4gICAgICAgICogQG1ldGhvZCBfaGFuZGxlU29ja2V0Q29ubmVjdGlvblxyXG4gICAgICAgICogQHBhcmFtIHtPYmplY3R9IHNvY2tldCBUaGUgc29ja2V0IHVzZWQgaW4gdGhlIGNvbm5lY3Rpb25cclxuICAgICAgICAqL1xyXG4gICAgICAgIF9oYW5kbGVTb2NrZXRDb25uZWN0aW9uKHNvY2tldCkge1xyXG4gICAgICAgICAgICBsZXQgY29ubmVjdGlvbiA9IG5ldyBDb25uZWN0aW9uKHRoaXMuX3BpZCwgc29ja2V0LCB0aGlzLl9oYW5kbGVTb2NrZXREaXNjb25uZWN0aW9uLCB0aGlzLl9saW5rU2Vzc2lvbiwgdGhpcy5fdW5saW5rU2Vzc2lvbik7XHJcbiAgICAgICAgICAgIHRoaXMuX2Nvbm5lY3Rpb25zW2Nvbm5lY3Rpb24udW5pcXVlSWRdID0gY29ubmVjdGlvbjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8qKiBcclxuICAgICAgICAqIDxwPiBEZXN0cm95IGEgUi5TaW1wbGVVcGxpbmtTZXJ2ZXIuQ29ubmVjdGlvbi4gPGJyIC8+XHJcbiAgICAgICAgKiBUcmlnZ2VyZWQgd2hlbiBhIHNvY2tldCBjb25uZWN0aW9uIGlzIGNsb3NlZCA8L3A+XHJcbiAgICAgICAgKiBAbWV0aG9kIF9oYW5kbGVTb2NrZXREaXNjb25uZWN0aW9uXHJcbiAgICAgICAgKiBAcGFyYW0ge3N0cmluZ30gdW5pcXVlSWQgVGhlIHVuaXF1ZSBJZCBvZiB0aGUgY29ubmVjdGlvblxyXG4gICAgICAgICovXHJcbiAgICAgICAgX2hhbmRsZVNvY2tldERpc2Nvbm5lY3Rpb24odW5pcXVlSWQpIHtcclxuICAgICAgICAgICAgbGV0IGd1aWQgPSB0aGlzLl9jb25uZWN0aW9uc1t1bmlxdWVJZF0uZ3VpZDtcclxuICAgICAgICAgICAgaWYoZ3VpZCAmJiB0aGlzLl9zZXNzaW9uc1tndWlkXSkge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fc2Vzc2lvbnNbZ3VpZF0uZGV0YWNoQ29ubmVjdGlvbigpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGRlbGV0ZSB0aGlzLl9jb25uZWN0aW9uc1t1bmlxdWVJZF07XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvKiogXHJcbiAgICAgICAgKiA8cD5MaW5rIGEgU2Vzc2lvbiBpbiBvcmRlciB0byBzZXQgdXAgc3Vic2NyaWJpbmcgYW5kIHVuc3Vic2NyaWJpbmcgbWV0aG9kcyB1cGxpbmstc2VydmVyLXNpZGU8L3A+XHJcbiAgICAgICAgKiBAbWV0aG9kIF9saW5rU2Vzc2lvblxyXG4gICAgICAgICogQHBhcmFtIHtTaW1wbGVVcGxpbmtTZXJ2ZXIuQ29ubmVjdGlvbn0gY29ubmVjdGlvbiBUaGUgY3JlYXRlZCBjb25uZWN0aW9uXHJcbiAgICAgICAgKiBAcGFyYW0ge3N0cmluZ30gZ3VpZCBVbmlxdWUgc3RyaW5nIEdVSURcclxuICAgICAgICAqIEByZXR1cm4ge29iamVjdH0gdGhlIG9iamVjdCB0aGF0IGNvbnRhaW5zIG1ldGhvZHMgc3Vic2NyaXB0aW9ucy91bnN1YnNjcmlwdGlvbnNcclxuICAgICAgICAqL1xyXG4gICAgICAgIF9saW5rU2Vzc2lvbihjb25uZWN0aW9uLCBndWlkKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBfLmNvcHJvbWlzZShmdW5jdGlvbiooKSB7XHJcbiAgICAgICAgICAgICAgICBpZighdGhpcy5fc2Vzc2lvbnNbZ3VpZF0pIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLl9zZXNzaW9uc1tndWlkXSA9IG5ldyBTZXNzaW9uKGd1aWQsIHRoaXMuX3N0b3JlRXZlbnRzLCB0aGlzLl9ldmVudHNFdmVudHMsIHRoaXMuX3Nlc3Npb25zRXZlbnRzLCB0aGlzLnNlc3Npb25UaW1lb3V0KTtcclxuICAgICAgICAgICAgICAgICAgICB5aWVsZCB0aGlzLnNlc3Npb25DcmVhdGVkKGd1aWQpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuX3Nlc3Npb25zW2d1aWRdLmF0dGFjaENvbm5lY3Rpb24oY29ubmVjdGlvbik7XHJcbiAgICAgICAgICAgIH0sdGhpcyk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvKiogXHJcbiAgICAgICAgKiA8cD5VbmxpbmsgYSBTZXNzaW9uPC9wPlxyXG4gICAgICAgICogQG1ldGhvZCBfdW5saW5rU2Vzc2lvblxyXG4gICAgICAgICogQHBhcmFtIHtTaW1wbGVVcGxpbmtTZXJ2ZXIuQ29ubmVjdGlvbn0gY29ubmVjdGlvbiBcclxuICAgICAgICAqIEBwYXJhbSB7c3RyaW5nfSBndWlkIFVuaXF1ZSBzdHJpbmcgR1VJRFxyXG4gICAgICAgICogQHJldHVybiB7RnVuY3Rpb259IGZuXHJcbiAgICAgICAgKi9cclxuICAgICAgICBfdW5saW5rU2Vzc2lvbihjb25uZWN0aW9uLCBndWlkKSB7XHJcbiAgICAgICAgICAgIHJldHVybihmbikgPT4ge1xyXG4gICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICBpZih0aGlzLl9zZXNzaW9uc1tndWlkXSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9zZXNzaW9uc1tndWlkXS50ZXJtaW5hdGUoKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBjYXRjaChlcnIpIHtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gZm4oUi5EZWJ1Zy5leHRlbmRFcnJvcignUi5TaW1wbGVVcGxpbmtTZXJ2ZXJJbnN0YW5jZS5fdW5saW5rU2Vzc2lvbiguLi4pJykpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgcmV0dXJuIGZuKG51bGwpO1xyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgIH1cclxuICAgICAgICAvKiogXHJcbiAgICAgICAgKiBAbWV0aG9kIF9oYW5kbGVTZXNzaW9uRXhwaXJlXHJcbiAgICAgICAgKiBAcGFyYW0ge3N0cmluZ30gZ3VpZCBVbmlxdWUgc3RyaW5nIEdVSURcclxuICAgICAgICAqL1xyXG4gICAgICAgIF9oYW5kbGVTZXNzaW9uRXhwaXJlKGd1aWQpIHtcclxuICAgICAgICAgICAgXy5kZXYoKCkgPT4gdGhpcy5fc2Vzc2lvbnMuZ3VpZC5zaG91bGQuYmUub2spO1xyXG4gICAgICAgICAgICBkZWxldGUgdGhpcy5fc2Vzc2lvbnNbZ3VpZF07XHJcbiAgICAgICAgICAgIGNvKGZ1bmN0aW9uKigpIHtcclxuICAgICAgICAgICAgICAgIHlpZWxkIHRoaXMuc2Vzc2lvbkRlc3Ryb3llZChndWlkKTtcclxuICAgICAgICAgICAgfSkuY2FsbCh0aGlzLCBSLkRlYnVnLnJldGhyb3coJ1IuU2ltcGxlVXBsaW5rU2VydmVyLl9oYW5kbGVTZXNzaW9uRXhwaXJlKC4uLiknKSk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgIH1cclxuXHJcbiAgICBfLmV4dGVuZChVcGxpbmtTaW1wbGVTZXJ2ZXIucHJvdG90eXBlLCAvKiogQGxlbmRzIFIuVXBsaW5rLnByb3RvdHlwZSAqLyB7XHJcbiAgICAgICAgX3NwZWNzOiBudWxsLFxyXG4gICAgICAgIF9waWQ6IG51bGwsXHJcbiAgICAgICAgX3ByZWZpeDogbnVsbCxcclxuICAgICAgICBfYXBwOiBudWxsLFxyXG4gICAgICAgIF9pbzogbnVsbCxcclxuICAgICAgICBfc3RvcmU6IG51bGwsXHJcbiAgICAgICAgX2hhc2hlczogbnVsbCxcclxuICAgICAgICBfc3RvcmVFdmVudHM6IG51bGwsXHJcbiAgICAgICAgX3N0b3JlUm91dGVyOiBudWxsLFxyXG4gICAgICAgIF9ldmVudHNSb3V0ZXI6IG51bGwsXHJcbiAgICAgICAgX2V2ZW50c0V2ZW50czogbnVsbCxcclxuICAgICAgICBfYWN0aW9uc1JvdXRlcjogbnVsbCxcclxuICAgICAgICBfc2Vzc2lvbnM6IG51bGwsXHJcbiAgICAgICAgX3Nlc3Npb25zRXZlbnRzOiBudWxsLFxyXG4gICAgICAgIF9jb25uZWN0aW9uczogbnVsbCxcclxuICAgICAgICBib290c3RyYXA6IG51bGwsXHJcbiAgICAgICAgc2Vzc2lvbkNyZWF0ZWQ6IG51bGwsXHJcbiAgICAgICAgc2Vzc2lvbkRlc3Ryb3llZDogbnVsbCxcclxuICAgICAgICBzZXNzaW9uVGltZW91dDogbnVsbCxcclxuICAgIH0pO1xyXG5cclxuXHJcblxyXG5cclxuICAgICAgICAvKiogXHJcbiAgICAgICAgKiA8cD5TZXR0aW5nIHVwIGEgY29ubmVjdGlvbiBpbiBvcmRlciB0byBpbml0aWFsaWVzIG1ldGhvZHMgYW5kIHRvIHByb3ZpZGVzIHNwZWNpZmljcyBsaXN0ZW5lcnMgb24gdGhlIHNvY2tldDwvcD5cclxuICAgICAgICAqIEBtZXRob2QgQ29ubmVjdGlvblxyXG4gICAgICAgICogQHBhcmFtIHtvYmplY3R9IHBpZCBcclxuICAgICAgICAqIEBwYXJhbSB7b2JqZWN0fSBzb2NrZXRcclxuICAgICAgICAqIEBwYXJhbSB7b2JqZWN0fSBoYW5kbGVTb2NrZXREaXNjb25uZWN0aW9uXHJcbiAgICAgICAgKiBAcGFyYW0ge29iamVjdH0gbGlua1Nlc3Npb24gXHJcbiAgICAgICAgKiBAcGFyYW0ge29iamVjdH0gdW5saW5rU2Vzc2lvblxyXG4gICAgICAgICovXHJcblxyXG4gICAgICAgIGNsYXNzIENvbm5lY3Rpb24ge1xyXG4gICAgICAgICAgICBjb25zdHJ1Y3Rvcih7cGlkLCBzb2NrZXQsIGhhbmRsZVNvY2tldERpc2Nvbm5lY3Rpb24sIGxpbmtTZXNzaW9uLCB1bmxpbmtTZXNzaW9ufSl7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9waWQgPSBwaWQ7XHJcbiAgICAgICAgICAgICAgICB0aGlzLnVuaXF1ZUlkID0gXy51bmlxdWVJZCgnUi5TaW1wbGVVcGxpbmtTZXJ2ZXIuQ29ubmVjdGlvbicpO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fc29ja2V0ID0gc29ja2V0O1xyXG4gICAgICAgICAgICAgICAgdGhpcy5faGFuZGxlU29ja2V0RGlzY29ubmVjdGlvbiA9IGhhbmRsZVNvY2tldERpc2Nvbm5lY3Rpb247XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9saW5rU2Vzc2lvbiA9IGxpbmtTZXNzaW9uO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fdW5saW5rU2Vzc2lvbiA9IHVubGlua1Nlc3Npb247XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9iaW5kSGFuZGxlcnMoKTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgLyoqIFxyXG4gICAgICAgICAgICAqIDxwPlNldHRpbmcgdXAgdGhlIHNwZWNpZmljcyBsaXN0ZW5lcnMgZm9yIHRoZSBzb2NrZXQ8L3A+XHJcbiAgICAgICAgICAgICogQG1ldGhvZCBfYmluZEhhbmRsZXJzXHJcbiAgICAgICAgICAgICovXHJcbiAgICAgICAgICAgIF9iaW5kSGFuZGxlcnMoKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9zb2NrZXQub24oJ2hhbmRzaGFrZScsIFIuc2NvcGUodGhpcy5faGFuZGxlSGFuZHNoYWtlLCB0aGlzKSk7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9zb2NrZXQub24oJ3N1YnNjcmliZVRvJywgUi5zY29wZSh0aGlzLl9oYW5kbGVTdWJzY3JpYmVUbywgdGhpcykpO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fc29ja2V0Lm9uKCd1bnN1YnNjcmliZUZyb20nLCBSLnNjb3BlKHRoaXMuX2hhbmRsZVVuc3Vic2NyaWJlRnJvbSwgdGhpcykpO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fc29ja2V0Lm9uKCdsaXN0ZW5UbycsIFIuc2NvcGUodGhpcy5faGFuZGxlTGlzdGVuVG8sIHRoaXMpKTtcclxuICAgICAgICAgICAgICAgIHRoaXMuX3NvY2tldC5vbigndW5saXN0ZW5Gcm9tJywgUi5zY29wZSh0aGlzLl9oYW5kbGVVbmxpc3RlbkZyb20sIHRoaXMpKTtcclxuICAgICAgICAgICAgICAgIHRoaXMuX3NvY2tldC5vbignZGlzY29ubmVjdCcsIFIuc2NvcGUodGhpcy5faGFuZGxlRGlzY29ubmVjdCwgdGhpcykpO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fc29ja2V0Lm9uKCd1bmhhbmRzaGFrZScsIFIuc2NvcGUodGhpcy5faGFuZGxlVW5IYW5kc2hha2UsIHRoaXMpKTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgLyoqXHJcbiAgICAgICAgICAgICogPHA+IFNpbXBseSBlbWl0IGEgc3BlY2lmaWMgYWN0aW9uIG9uIHRoZSBzb2NrZXQgPC9wPlxyXG4gICAgICAgICAgICAqIEBtZXRob2QgZW1pdFxyXG4gICAgICAgICAgICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIFRoZSBuYW1lIG9mIHRoZSBhY3Rpb24gdG8gc2VuZFxyXG4gICAgICAgICAgICAqIEBwYXJhbSB7b2JqZWN0fSBwYXJhbXMgVGhlIHBhcmFtcyBcclxuICAgICAgICAgICAgKi9cclxuICAgICAgICAgICAgZW1pdChuYW1lLCBwYXJhbXMpIHtcclxuICAgICAgICAgICAgICAgIF8uZGV2KCgpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oJ1tDXSA+Pj4gJyArIG5hbWUsIHBhcmFtcyk7XHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgIHRoaXMuX3NvY2tldC5lbWl0KG5hbWUsIHBhcmFtcyk7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIC8qKlxyXG4gICAgICAgICAgICAqIDxwPiBUcmlnZ2VyZWQgYnkgdGhlIHJlY2VudGx5IGNvbm5lY3RlZCBjbGllbnQuIDxiciAvPlxyXG4gICAgICAgICAgICAqIENvbWJpbmVzIG1ldGhvZHMgb2Ygc3Vic2NyaXB0aW9ucyB0aGF0IHdpbGwgYmUgdHJpZ2dlcmVkIGJ5IHRoZSBjbGllbnQgdmlhIHNvY2tldCBsaXN0ZW5pbmc8L3A+XHJcbiAgICAgICAgICAgICogQG1ldGhvZCBfaGFuZGxlSGFuZHNoYWtlXHJcbiAgICAgICAgICAgICogQHBhcmFtIHtTdHJpbmd9IHBhcmFtcyBDb250YWlucyB0aGUgdW5pcXVlIHN0cmluZyBHVUlEXHJcbiAgICAgICAgICAgICovXHJcbiAgICAgICAgICAgIF9oYW5kbGVIYW5kc2hha2UocGFyYW1zKSB7XHJcbiAgICAgICAgICAgICAgICBpZighcGFyYW1zLmd1aWQuc2hvdWxkLmJlLm9rIHx8ICFwYXJhbXMuZ3VpZC5zaG91bGQuYmUuYS5TdHJpbmcpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLmVtaXQoJ2VycicsIHsgZXJyOiAnaGFuZHNoYWtlLnBhcmFtcy5ndWlkOiBleHBlY3RlZCBTdHJpbmcuJ30pO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgZWxzZSBpZih0aGlzLmd1aWQpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLmVtaXQoJ2VycicsIHsgZXJyOiAnaGFuZHNoYWtlOiBzZXNzaW9uIGFscmVhZHkgbGlua2VkLid9KTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvKGZ1bmN0aW9uKigpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5ndWlkID0gcGFyYW1zLmd1aWQ7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGxldCBzID0geWllbGQgdGhpcy5fbGlua1Nlc3Npb24odGhpcywgdGhpcy5ndWlkKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5lbWl0KCdoYW5kc2hha2UtYWNrJywge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcGlkOiB0aGlzLl9waWQsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZWNvdmVyZWQ6IHMucmVjb3ZlcmVkLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5fc3Vic2NyaWJlVG8gPSBzLnN1YnNjcmliZVRvO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl91bnN1YnNjcmliZUZyb20gPSBzLnVuc3Vic2NyaWJlRnJvbTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5fbGlzdGVuVG8gPSBzLmxpc3RlblRvO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl91bmxpc3RlbkZyb20gPSBzLnVubGlzdGVuRnJvbTtcclxuICAgICAgICAgICAgICAgICAgICB9KS5jYWxsKHRoaXMsIFIuRGVidWcucmV0aHJvdygnUi5TaW1wbGVVcGxpbmtTZXJ2ZXIuQ29ubmVjdGlvbi5faGFuZGxlSGFuZHNoYWtlKC4uLiknKSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIC8qKlxyXG4gICAgICAgICAgICAqIDxwPiBUcmlnZ2VyZWQgYnkgdGhlIHJlY2VudGx5IGRpc2Nvbm5lY3RlZCBjbGllbnQuIDxiciAvPlxyXG4gICAgICAgICAgICAqIFJlbW92ZXMgbWV0aG9kcyBvZiBzdWJzY3JpcHRpb25zPC9wPlxyXG4gICAgICAgICAgICAqIEBtZXRob2QgX2hhbmRsZUhhbmRzaGFrZVxyXG4gICAgICAgICAgICAqL1xyXG4gICAgICAgICAgICBfaGFuZGxlVW5IYW5kc2hha2UoKSB7XHJcbiAgICAgICAgICAgICAgICBpZighdGhpcy5ndWlkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5lbWl0KCdlcnInLCB7IGVycjogJ3VuaGFuZHNoYWtlOiBubyBhY3RpdmUgc2Vzc2lvbi4nfSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICBjbyhmdW5jdGlvbiooKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX3N1YnNjcmliZVRvID0gbnVsbDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5fdW5zdWJzY3JpYmVGcm9tID0gbnVsbDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5fbGlzdGVuVG8gPSBudWxsO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl91bmxpc3RlbkZyb20gPSBudWxsO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBsZXQgcyA9IHlpZWxkIHRoaXMuX3VubGlua1Nlc3Npb24odGhpcywgdGhpcy5ndWlkKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5lbWl0KCd1bmhhbmRzaGFrZS1hY2snKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5ndWlkID0gbnVsbDtcclxuICAgICAgICAgICAgICAgICAgICB9KS5jYWxsKHRoaXMsIFIuRGVidWcucmV0aHJvdygnUi5TaW1wbGVVcGxpbmtTZXJ2ZXIuQ29ubmVjdGlvbi5faGFuZGxlVW5IYW5kc2hha2UoLi4uKScpKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgLyoqIFxyXG4gICAgICAgICAgICAqIDxwPk1hcHMgdGhlIHRyaWdnZXJlZCBldmVudCB3aXRoIHRoZSBfc3Vic2NyaWJlVG8gbWV0aG9kcyA8L3A+XHJcbiAgICAgICAgICAgICogQG1ldGhvZCBfaGFuZGxlU3Vic2NyaWJlVG9cclxuICAgICAgICAgICAgKiBAcGFyYW0ge29iamVjdH0gcGFyYW1zIENvbnRhaW5zIHRoZSBrZXkgcHJvdmlkZWQgYnkgY2xpZW50XHJcbiAgICAgICAgICAgICovXHJcbiAgICAgICAgICAgIF9oYW5kbGVTdWJzY3JpYmVUbyhwYXJhbXMpIHtcclxuICAgICAgICAgICAgICAgIGlmKCFwYXJhbXMua2V5LnNob3VsZC5iZS5vayB8fCAhcGFyYW1zLmtleS5zaG91bGQuYmUuYS5TdHJpbmcpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLmVtaXQoJ2VycicsIHsgZXJyOiAnc3Vic2NyaWJlVG8ucGFyYW1zLmtleTogZXhwZWN0ZWQgU3RyaW5nLicgfSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBlbHNlIGlmKCF0aGlzLl9zdWJzY3JpYmVUbykge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuZW1pdCgnZXJyJywgeyBlcnI6ICdzdWJzY3JpYmVUbzogcmVxdWlyZXMgaGFuZHNoYWtlLicgfSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLl9zdWJzY3JpYmVUbyhwYXJhbXMua2V5KTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgLyoqIFxyXG4gICAgICAgICAgICAqIDxwPk1hcHMgdGhlIHRyaWdnZXJlZCBldmVudCB3aXRoIHRoZSBfdW5zdWJzY3JpYmVGcm9tIG1ldGhvZHM8L3A+XHJcbiAgICAgICAgICAgICogQG1ldGhvZCBfaGFuZGxlVW5zdWJzY3JpYmVGcm9tXHJcbiAgICAgICAgICAgICogQHBhcmFtIHtvYmplY3R9IHBhcmFtcyBDb250YWlucyB0aGUga2V5IHByb3ZpZGVkIGJ5IGNsaWVudFxyXG4gICAgICAgICAgICAqL1xyXG4gICAgICAgICAgICBfaGFuZGxlVW5zdWJzY3JpYmVGcm9tKHBhcmFtcykge1xyXG4gICAgICAgICAgICAgICAgaWYoIXBhcmFtcy5rZXkuc2hvdWxkLmJlLm9rIHx8ICFwYXJhbXMua2V5LnNob3VsZC5iZS5hLlN0cmluZykge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuZW1pdCgnZXJyJywgeyBlcnI6ICd1bnN1YnNjcmliZUZyb20ucGFyYW1zLmtleTogZXhwZWN0ZWQgU3RyaW5nLicgfSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBlbHNlIGlmKCF0aGlzLl91bnN1YnNjcmliZUZyb20pIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLmVtaXQoJ2VycicsIHsgZXJyOiAndW5zdWJzY3JpYmVGcm9tOiByZXF1aXJlcyBoYW5kc2hha2UuJyB9KTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3Vuc3Vic2NyaWJlRnJvbShwYXJhbXMua2V5KTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgLyoqIFxyXG4gICAgICAgICAgICAqIDxwPk1hcHMgdGhlIHRyaWdnZXJlZCBldmVudCB3aXRoIHRoZSBsaXN0ZW5UbyBtZXRob2RzPC9wPlxyXG4gICAgICAgICAgICAqIEBtZXRob2QgX2hhbmRsZUxpc3RlblRvXHJcbiAgICAgICAgICAgICogQHBhcmFtIHtvYmplY3R9IHBhcmFtcyBDb250YWlucyB0aGUgZXZlbnROYW1lIHByb3ZpZGVkIGJ5IGNsaWVudFxyXG4gICAgICAgICAgICAqL1xyXG4gICAgICAgICAgICBfaGFuZGxlTGlzdGVuVG8ocGFyYW1zKSB7XHJcbiAgICAgICAgICAgICAgICBpZighcGFyYW1zLmV2ZW50TmFtZS5zaG91bGQuYmUub2sgfHwgIXBhcmFtcy5ldmVudE5hbWUuc2hvdWxkLmJlLmEuU3RyaW5nKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5lbWl0KCdlcnInLCB7IGVycjogJ2xpc3RlblRvLnBhcmFtcy5ldmVudE5hbWU6IGV4cGVjdGVkIFN0cmluZy4nIH0pO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgZWxzZSBpZighdGhpcy5fbGlzdGVuVG8pIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLmVtaXQoJ2VycicsIHsgZXJyOiAnbGlzdGVuVG86IHJlcXVpcmVzIGhhbmRzaGFrZS4nIH0pO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5saXN0ZW5UbyhwYXJhbXMuZXZlbnROYW1lKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgLyoqIFxyXG4gICAgICAgICAgICAqIDxwPk1hcHMgdGhlIHRyaWdnZXJlZCBldmVudCB3aXRoIHRoZSB1bmxpc3RlbkZyb20gbWV0aG9kczwvcD5cclxuICAgICAgICAgICAgKiBAbWV0aG9kIF9oYW5kbGVVbmxpc3RlbkZyb21cclxuICAgICAgICAgICAgKiBAcGFyYW0ge29iamVjdH0gcGFyYW1zIENvbnRhaW5zIHRoZSBldmVudE5hbWUgcHJvdmlkZWQgYnkgY2xpZW50XHJcbiAgICAgICAgICAgICovXHJcbiAgICAgICAgICAgIF9oYW5kbGVVbmxpc3RlbkZyb20ocGFyYW1zKSB7XHJcbiAgICAgICAgICAgICAgICBpZighcGFyYW1zLmV2ZW50TmFtZS5zaG91bGQuYmUub2sgfHwgIXBhcmFtcy5ldmVudE5hbWUuc2hvdWxkLmJlLmEuU3RyaW5nKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5lbWl0KCdlcnInLCB7IGVycjogJ3VubGlzdGVuRnJvbS5wYXJhbXMuZXZlbnROYW1lOiBleHBlY3RlZCBTdHJpbmcuJyB9KTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGVsc2UgaWYoIXRoaXMudW5saXN0ZW5Gcm9tKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fZW1pdCgnZXJyJywgeyBlcnI6ICd1bmxpc3RlbkZyb206IHJlcXVpcmVzIGhhbmRzaGFrZS4nIH0pO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy51bmxpc3RlbkZyb20ocGFyYW1zLmV2ZW50TmFtZSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgIC8qKiBcclxuICAgICAgICAgICAgKiA8cD5UcmlnZ2VyZWQgYnkgdGhlIHJlY2VudGx5IGRpc2Nvbm5lY3RlZCBjbGllbnQuPC9wPlxyXG4gICAgICAgICAgICAqIEBtZXRob2QgX2hhbmRsZURpc2Nvbm5lY3RcclxuICAgICAgICAgICAgKi9cclxuICAgICAgICAgICAgX2hhbmRsZURpc2Nvbm5lY3QoKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9oYW5kbGVTb2NrZXREaXNjb25uZWN0aW9uKHRoaXMudW5pcXVlSWQsIGZhbHNlKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgXy5leHRlbmQoQ29ubmVjdGlvbi5wcm90b3R5cGUsIC8qKiBAbGVuZHMgUi5VcGxpbmsucHJvdG90eXBlICovIHtcclxuICAgICAgICAgICAgX3NvY2tldDogbnVsbCxcclxuICAgICAgICAgICAgX3BpZDogbnVsbCxcclxuICAgICAgICAgICAgdW5pcXVlSWQ6IG51bGwsXHJcbiAgICAgICAgICAgIGd1aWQ6IG51bGwsXHJcbiAgICAgICAgICAgIF9oYW5kbGVTb2NrZXREaXNjb25uZWN0aW9uOiBudWxsLFxyXG4gICAgICAgICAgICBfbGlua1Nlc3Npb246IG51bGwsXHJcbiAgICAgICAgICAgIF91bmxpbmtTZXNzaW9uOiBudWxsLFxyXG4gICAgICAgICAgICBfc3Vic2NyaWJlVG86IG51bGwsXHJcbiAgICAgICAgICAgIF91bnN1YnNjcmliZUZyb206IG51bGwsXHJcbiAgICAgICAgICAgIF9saXN0ZW5UbzogbnVsbCxcclxuICAgICAgICAgICAgX3VubGlzdGVuRnJvbTogbnVsbCxcclxuICAgICAgICAgICAgX2Rpc2Nvbm5lY3RlZDogbnVsbCxcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgLyoqIFxyXG4gICAgICAgICogPHA+U2V0dGluZyB1cCBhIHNlc3Npb248L3A+XHJcbiAgICAgICAgKiBAbWV0aG9kIFNlc3Npb25cclxuICAgICAgICAqIEBwYXJhbSB7b2JqZWN0fSBwaWQgXHJcbiAgICAgICAgKiBAcGFyYW0ge29iamVjdH0gc3RvcmVFdmVudHNcclxuICAgICAgICAqIEBwYXJhbSB7b2JqZWN0fSBldmVudHNFdmVudHNcclxuICAgICAgICAqIEBwYXJhbSB7b2JqZWN0fSBzZXNzaW9uc0V2ZW50cyBcclxuICAgICAgICAqIEBwYXJhbSB7b2JqZWN0fSB0aW1lb3V0XHJcbiAgICAgICAgKi9cclxuICAgICAgICBjbGFzcyBTZXNzaW9uIHtcclxuICAgICAgICAgICAgY29uc3RydWN0b3Ioe2d1aWQsIHN0b3JlRXZlbnRzLCBldmVudHNFdmVudHMsIHNlc3Npb25zRXZlbnRzLCB0aW1lb3V0fSkge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fZ3VpZCA9IGd1aWQ7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9zdG9yZUV2ZW50cyA9IHN0b3JlRXZlbnRzO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fZXZlbnRzRXZlbnRzID0gZXZlbnRzRXZlbnRzO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fc2Vzc2lvbnNFdmVudHMgPSBzZXNzaW9uc0V2ZW50cztcclxuICAgICAgICAgICAgICAgIHRoaXMuX21lc3NhZ2VRdWV1ZSA9IFtdO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fdGltZW91dER1cmF0aW9uID0gdGltZW91dDtcclxuICAgICAgICAgICAgICAgIHRoaXMuX2V4cGlyZSA9IFIuc2NvcGUodGhpcy5fZXhwaXJlLCB0aGlzKTtcclxuICAgICAgICAgICAgICAgIHRoaXMuX2V4cGlyZVRpbWVvdXQgPSBzZXRUaW1lb3V0KHRoaXMuX2V4cGlyZSwgdGhpcy5fdGltZW91dER1cmF0aW9uKTtcclxuICAgICAgICAgICAgICAgIHRoaXMuX3N1YnNjcmlwdGlvbnMgPSB7fTtcclxuICAgICAgICAgICAgICAgIHRoaXMuX2xpc3RlbmVycyA9IHt9O1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAvKipcclxuICAgICAgICAgICAgKiA8cD5CaW5kIHRoZSBzdWJzY3JpYmluZyBhbmQgdW5zdWJzY3JpYmluZyBtZXRob2RzIHdoZW4gYSBjb25uZWN0aW9uIGlzIGVzdGFibGlzaGVkIDxiciAvPlxyXG4gICAgICAgICAgICAqIE1ldGhvZHMgdGhhdCB0cmlnZ2VyIG9uIGNsaWVudCBpc3N1ZXMgKGxpa2UgZW1pdChcInN1YnNjcmliZVRvXCIpLCBlbWl0KFwidW5zdWJzY3JpYmVGcm9tXCIpKTwvcD5cclxuICAgICAgICAgICAgKiBAbWV0aG9kIGF0dGFjaENvbm5lY3Rpb25cclxuICAgICAgICAgICAgKiBAcGFyYW0ge1NpbXBsZVVwbGlua1NlcnZlci5Db25uZWN0aW9ufSBjb25uZWN0aW9uIHRoZSBjdXJyZW50IGNyZWF0ZWQgY29ubmVjdGlvblxyXG4gICAgICAgICAgICAqIEByZXR1cm4ge29iamVjdH0gdGhlIGJpbmRlZCBvYmplY3Qgd2l0aCBtZXRob2RzXHJcbiAgICAgICAgICAgICovXHJcbiAgICAgICAgICAgIGF0dGFjaENvbm5lY3Rpb24oY29ubmVjdGlvbikge1xyXG4gICAgICAgICAgICAgICAgbGV0IHJlY292ZXJlZCA9ICh0aGlzLl9jb25uZWN0aW9uICE9PSBudWxsKTtcclxuICAgICAgICAgICAgICAgIHRoaXMuZGV0YWNoQ29ubmVjdGlvbigpO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fY29ubmVjdGlvbiA9IGNvbm5lY3Rpb247XHJcbiAgICAgICAgICAgICAgICBfLmVhY2godGhpcy5fbWVzc2FnZVF1ZXVlLCBmdW5jdGlvbihtKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29ubmVjdGlvbi5lbWl0KG0ubmFtZSwgbS5wYXJhbXMpO1xyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9tZXNzYWdlUXVldWUgPSBudWxsO1xyXG4gICAgICAgICAgICAgICAgY2xlYXJUaW1lb3V0KHRoaXMuX2V4cGlyZVRpbWVvdXQpO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgICAgICByZWNvdmVyZWQ6IHJlY292ZXJlZCxcclxuICAgICAgICAgICAgICAgICAgICBzdWJzY3JpYmVUbzogUi5zY29wZSh0aGlzLnN1YnNjcmliZVRvLCB0aGlzKSxcclxuICAgICAgICAgICAgICAgICAgICB1bnN1YnNjcmliZUZyb206IFIuc2NvcGUodGhpcy51bnN1YnNjcmliZUZyb20sIHRoaXMpLFxyXG4gICAgICAgICAgICAgICAgICAgIGxpc3RlblRvOiBSLnNjb3BlKHRoaXMubGlzdGVuVG8sIHRoaXMpLFxyXG4gICAgICAgICAgICAgICAgICAgIHVubGlzdGVuRnJvbTogUi5zY29wZSh0aGlzLnVubGlzdGVuRnJvbSwgdGhpcyksXHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAvKipcclxuICAgICAgICAgICAgKiA8cD5SZW1vdmUgdGhlIHByZXZpb3VzbHkgYWRkZWQgY29ubmVjdGlvbiwgYW5kIGNsZWFuIHRoZSBtZXNzYWdlIHF1ZXVlIDwvcD5cclxuICAgICAgICAgICAgKiBAbWV0aG9kIGRldGFjaENvbm5lY3Rpb25cclxuICAgICAgICAgICAgKi9cclxuICAgICAgICAgICAgZGV0YWNoQ29ubmVjdGlvbigpIHtcclxuICAgICAgICAgICAgICAgIGlmKHRoaXMuX2Nvbm5lY3Rpb24gPT09IG51bGwpIHtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLl9jb25uZWN0aW9uID0gbnVsbDtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLl9tZXNzYWdlUXVldWUgPSBbXTtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLl9leHBpcmVUaW1lb3V0ID0gc2V0VGltZW91dCh0aGlzLl9leHBpcmUsIHRoaXMuX3RpbWVvdXREdXJhdGlvbik7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIC8qKlxyXG4gICAgICAgICAgICAqIEBtZXRob2QgdGVybWluYXRlXHJcbiAgICAgICAgICAgICovXHJcbiAgICAgICAgICAgIHRlcm1pbmF0ZSgpIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuX2V4cGlyZSgpO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAvKiogXHJcbiAgICAgICAgICAgICogPHA+TWV0aG9kIGludm9rZWQgYnkgY2xpZW50IHZpYSBzb2NrZXQgZW1pdCA8YnIgLz5cclxuICAgICAgICAgICAgKiBTdG9yZSB0aGUgX3NpZ25hbFVwZGF0ZSBtZXRob2QgaW4gc3Vic2NyaXB0aW9uIDxiciAvPlxyXG4gICAgICAgICAgICAqIEFkZCBhIGxpc3RlbmVyIHRoYXQgd2lsbCBjYWxsIF9zaWduYWxVcGRhdGUgd2hlbiB0cmlnZ2VyZWQgPC9wPlxyXG4gICAgICAgICAgICAqIEBtZXRob2Qgc3Vic2NyaWJlVG9cclxuICAgICAgICAgICAgKiBAcGFyYW0ge3N0cmluZ30ga2V5IFRoZSBrZXkgdG8gc3Vic2NyaWJlXHJcbiAgICAgICAgICAgICovXHJcbiAgICAgICAgICAgIHN1YnNjcmliZVRvKGtleSkge1xyXG4gICAgICAgICAgICAgICAgXy5kZXYoKCkgPT4gdGhpcy5fc3Vic2NyaXB0aW9ucy5rZXkuc2hvdWxkLmJlLm9rKTtcclxuICAgICAgICAgICAgICAgIHRoaXMuX3N1YnNjcmlwdGlvbnNba2V5XSA9IHRoaXMuX3NpZ25hbFVwZGF0ZSgpO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fc3RvcmVFdmVudHMuYWRkTGlzdGVuZXIoJ3NldDonICsga2V5LCB0aGlzLl9zdWJzY3JpcHRpb25zW2tleV0pO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAvKiogXHJcbiAgICAgICAgICAgICogPHA+TWV0aG9kIGludm9rZWQgYnkgY2xpZW50IHZpYSBzb2NrZXQgZW1pdCA8YnIgLz5cclxuICAgICAgICAgICAgKiBSZW1vdmUgYSBsaXN0ZW5lciBhY2NvcmRpbmcgdG8gdGhlIGtleTwvcD5cclxuICAgICAgICAgICAgKiBAbWV0aG9kIHN1YnNjcmliZVRvXHJcbiAgICAgICAgICAgICogQHBhcmFtIHtzdHJpbmd9IGtleSBUaGUga2V5IHRvIHVuc3Vic2NyaWJlXHJcbiAgICAgICAgICAgICovXHJcbiAgICAgICAgICAgIHV1bnN1YnNjcmliZUZyb20oa2V5KSB7XHJcbiAgICAgICAgICAgICAgICBfLmRldigoKSA9PiB0aGlzLl9zdWJzY3JpcHRpb25zLmtleS5zaG91bGQuYmUub2spO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fc3RvcmVFdmVudHMucmVtb3ZlTGlzdGVuZXIoJ3NldDonICsga2V5LCB0aGlzLl9zdWJzY3JpcHRpb25zW2tleV0pO1xyXG4gICAgICAgICAgICAgICAgZGVsZXRlIHRoaXMuX3N1YnNjcmlwdGlvbnNba2V5XTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgLyoqXHJcbiAgICAgICAgICAgICogPHA+IFNpbXBseSBlbWl0IGEgc3BlY2lmaWMgYWN0aW9uIG9uIHRoZSBzb2NrZXQgPC9wPlxyXG4gICAgICAgICAgICAqIEBtZXRob2QgX2VtaXRcclxuICAgICAgICAgICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSBUaGUgbmFtZSBvZiB0aGUgYWN0aW9uIHRvIHNlbmRcclxuICAgICAgICAgICAgKiBAcGFyYW0ge29iamVjdH0gcGFyYW1zIFRoZSBwYXJhbXMgXHJcbiAgICAgICAgICAgICovXHJcbiAgICAgICAgICAgIF9lbWl0KG5hbWUsIHBhcmFtcykge1xyXG4gICAgICAgICAgICAgICAgXy5kZXYoKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUud2FybignW1NdID4+PiAnICsgbmFtZSwgcGFyYW1zKTtcclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgaWYodGhpcy5fY29ubmVjdGlvbiAhPT0gbnVsbCkge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX2Nvbm5lY3Rpb24uZW1pdChuYW1lLCBwYXJhbXMpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fbWVzc2FnZVF1ZXVlLnB1c2goe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiBuYW1lLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBwYXJhbXM6IHBhcmFtcyxcclxuICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgLyoqIDxwPlB1c2ggYW4gdXBkYXRlIGFjdGlvbiBvbiB0aGUgc29ja2V0LiA8YnIgLz5cclxuICAgICAgICAgICAgKiBUaGUgY2xpZW50IGlzIGxpc3RlbmluZyBvbiB0aGUgYWN0aW9uIFwidXBkYXRlXCIgc29ja2V0IDwvcD5cclxuICAgICAgICAgICAgKiBAbWV0aG9kIF9zaWduYWxVcGRhdGVcclxuICAgICAgICAgICAgKi9cclxuICAgICAgICAgICAgX3NpZ25hbFVwZGF0ZSgpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiAocGF0Y2gpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLl9lbWl0KCd1cGRhdGUnLCBwYXRjaCk7XHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAvKiogPHA+UHVzaCBhbiBldmVudCBhY3Rpb24gb24gdGhlIHNvY2tldC4gPGJyIC8+XHJcbiAgICAgICAgICAgICogVGhlIGNsaWVudCBpcyBsaXN0ZW5pbmcgb24gdGhlIGFjdGlvbiBcImV2ZW50XCIgc29ja2V0IDwvcD5cclxuICAgICAgICAgICAgKiBAbWV0aG9kIF9zaWduYWxFdmVudFxyXG4gICAgICAgICAgICAqL1xyXG4gICAgICAgICAgICBfc2lnbmFsRXZlbnQoZXZlbnROYW1lKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gKHBhcmFtcykgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX2VtaXQoJ2V2ZW50JywgeyBldmVudE5hbWU6IGV2ZW50TmFtZSwgcGFyYW1zOiBwYXJhbXMgfSk7XHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAvKipcclxuICAgICAgICAgICAgKiBAbWV0aG9kIF9leHBpcmVcclxuICAgICAgICAgICAgKi9cclxuICAgICAgICAgICAgX2V4cGlyZSgpIHtcclxuICAgICAgICAgICAgICAgIE9iamVjdC5rZXlzKHRoaXMuX3N1YnNjcmlwdGlvbnMpLmZvckVhY2goUi5zY29wZSh0aGlzLnVuc3Vic2NyaWJlRnJvbSwgdGhpcykpO1xyXG4gICAgICAgICAgICAgICAgT2JqZWN0LmtleXModGhpcy5fbGlzdGVuZXJzKS5mb3JFYWNoKFIuc2NvcGUodGhpcy51bmxpc3RlbkZyb20sIHRoaXMpKTtcclxuICAgICAgICAgICAgICAgIHRoaXMuX3Nlc3Npb25zRXZlbnRzLmVtaXQoJ2V4cGlyZScsIHRoaXMuX2d1aWQpO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAvKipcclxuICAgICAgICAgICAgKiA8cD4gQ3JlYXRlIGEgbGlzdGVuZXIgZm9yIHRoZSBldmVudHMgPC9wPlxyXG4gICAgICAgICAgICAqIEBtZXRob2QgbGlzdGVuVG9cclxuICAgICAgICAgICAgKiBAcGFyYW0ge3N0cmluZ30gZXZlbnROYW1lIFRoZSBuYW1lIG9mIHRoZSBldmVudCB0aGF0IHdpbGwgYmUgcmVnaXN0ZXJlZFxyXG4gICAgICAgICAgICAqL1xyXG4gICAgICAgICAgICBsaXN0ZW5UbyhldmVudE5hbWUpIHtcclxuICAgICAgICAgICAgICAgIF8uZGV2KCgpID0+IHRoaXMuX2xpc3RlbmVycy5rZXkuc2hvdWxkLmJlLm9rKTtcclxuICAgICAgICAgICAgICAgIHRoaXMuX2xpc3RlbmVyc1tldmVudE5hbWVdID0gdGhpcy5fc2lnbmFsRXZlbnQoZXZlbnROYW1lKTtcclxuICAgICAgICAgICAgICAgIHRoaXMuX2V2ZW50c0V2ZW50cy5hZGRMaXN0ZW5lcignZW1pdDonICsgZXZlbnROYW1lLCB0aGlzLl9saXN0ZW5lcnNbZXZlbnROYW1lXSk7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIC8qKlxyXG4gICAgICAgICAgICAqIDxwPiBSZW1vdmUgYSBsaXN0ZW5lciBmcm9tIHRoZSBldmVudHMgPC9wPlxyXG4gICAgICAgICAgICAqIEBtZXRob2QgdW5saXN0ZW5Gcm9tXHJcbiAgICAgICAgICAgICogQHBhcmFtIHtzdHJpbmd9IGV2ZW50TmFtZSBUaGUgbmFtZSBvZiB0aGUgZXZlbnQgdGhhdCB3aWxsIGJlIHVucmVnaXN0ZXJlZFxyXG4gICAgICAgICAgICAqL1xyXG4gICAgICAgICAgICB1bmxpc3RlbkZyb20oZXZlbnROYW1lKSB7XHJcbiAgICAgICAgICAgICAgICBfLmRldigoKSA9PiB0aGlzLl9saXN0ZW5lcnMuZXZlbnROYW1lLnNob3VsZC5iZS5vayk7XHJcbiAgICAgICAgICAgICAgICB0aGlzLl9ldmVudHNFdmVudHMucmVtb3ZlTGlzdGVuZXIoJ2VtaXQ6JyArIGV2ZW50TmFtZSwgdGhpcy5fbGlzdGVuZXJzW2V2ZW50TmFtZV0pO1xyXG4gICAgICAgICAgICAgICAgZGVsZXRlIHRoaXMuX2xpc3RlbmVyc1tldmVudE5hbWVdO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgIH0gICBcclxuXHJcbiAgICAgICAgXy5leHRlbmQoU2Vzc2lvbi5wcm90b3R5cGUsIC8qKiBAbGVuZHMgUi5VcGxpbmsucHJvdG90eXBlICovIHtcclxuICAgICAgICAgICAgX2d1aWQ6IG51bGwsXHJcbiAgICAgICAgICAgIF9jb25uZWN0aW9uOiBudWxsLFxyXG4gICAgICAgICAgICBfc3Vic2NyaXB0aW9uczogbnVsbCxcclxuICAgICAgICAgICAgX2xpc3RlbmVyczogbnVsbCxcclxuICAgICAgICAgICAgX3N0b3JlRXZlbnRzOiBudWxsLFxyXG4gICAgICAgICAgICBfZXZlbnRzRXZlbnRzOiBudWxsLFxyXG4gICAgICAgICAgICBfc2Vzc2lvbnNFdmVudHM6IG51bGwsXHJcbiAgICAgICAgICAgIF9tZXNzYWdlUXVldWU6IG51bGwsXHJcbiAgICAgICAgICAgIF9leHBpcmVUaW1lb3V0OiBudWxsLFxyXG4gICAgICAgICAgICBfdGltZW91dER1cmF0aW9uOiBudWxsLFxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgIHJldHVybiBTaW1wbGVVcGxpbmtTZXJ2ZXI7XHJcbn07XHJcbiJdLCJzb3VyY2VSb290IjoiL3NvdXJjZS8ifQ==