const express = require('express')
const app = express()
const http = require('http').createServer(app)
const io = require('socket.io')(http)
const fs = require('fs')
const bcrypt = require('bcrypt')
const saltRounds = 10

//init sqlite db
const dbFile = "./data/sqlite.db"
const exists = fs.existsSync(dbFile)
const sqlite3 = require('sqlite3').verbose()
const db = new sqlite3.Database(dbFile)

let players = [];
let loaded_rooms = [];

//if ./data/sqlite.db not exist, create it
db.serialize(() => {
    if (!exists) {
        db.run("CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, password TEXT, email TEXT, coins INTEGER)")
        db.run("CREATE TABLE rooms (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, owner INTEGER, map TEXT, door TEXT)")
        db.run("CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, type TEXT, image TEXT, width INTEGER, height INTEGER)")
        db.run("CREATE TABLE shop_pages (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, order_num TEXT, parent INTEGER)")
        db.run("CREATE TABLE shop_items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, item_id INTEGER, price REAL, is_limmited INTEGER, item_left INTEGER)")
        db.run("CREATE TABLE furniture (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER, owner INTEGER, room INTEGER, x INTEGER, y INTEGER)")
        db.run("INSERT INTO rooms (name, owner, map, door) VALUES ('Welcome Lounge', '0', '[[0, 0, 0, 0, 1, 0, 0, 0, 0],[1, 1, 1, 1, 1, 1, 1, 1, 1],[1, 1, 1, 1, 1, 1, 1, 1, 1],[1, 1, 1, 1, 1, 1, 1, 1, 1],[1, 1, 1, 1, 1, 1, 1, 1, 1],[1, 1, 1, 1, 1, 1, 1, 1, 1]]', '[4, 0]')")
    }
});


app.use('/', express.static(__dirname + '/client'))

io.on('connection', (socket) => {
    const join_room = rid => {
        let door_x = 0
        let door_y = 0
        db.each("SELECT * FROM rooms WHERE id = ?", rid, (err, res) => {
            if (res["COUNT(*)"] != 0) {
                socket.emit("room", { name: res.name, map: res.map, door: res.door })
                let door_ = JSON.parse(res.door)
                door_x = door_[0]
                door_y = door_[1]

                let room_loaded = loaded_rooms.some(room => {
                    return room.id == rid
                })

                if (typeof (socket.my_room) == "undefined") {
                    // not from any room, just entered this room / No room to unload
                    if (room_loaded) {
                        //if room already exist (have player in it)
                        loaded_rooms.filter(room => {
                            if (room.id == rid) {
                                room.users++
                            }
                        })
                    }
                    else {
                        //room already have plyr in it
                        loaded_rooms.push({ id: rid, name: res.name, users: 1 });
                    }

                    socket.join(rid)

                    players.filter(player => {
                        if (player.socket == socket.id) {
                            player.x = door_x
                            player.y = door_y
                            player.state = "stand"
                        }
                    })

                    socket.my_room = rid
                    let player_in_room = players.filter(player => { return player.room == rid });
                    io.in(socket.my_room).emit("player_update", player_in_room)
                }
                else {
                    if (socket.my_room != rid) {
                        if (room_loaded) { //if target room exist / have someone else
                            loaded_rooms.filter(room => {
                                if (room.id == rid) {
                                    room.users++
                                }
                            })
                            loaded_rooms.filter((room, index) => {
                                if (room.id == socket.my_room) {
                                    room.users--
                                    if (room.users == 0) {
                                        loaded_rooms.splice(index, 1)
                                    }
                                }
                            })
                        }
                        else {
                            loaded_rooms.filter((room, index) => {
                                if (room.id == socket.my_room) {
                                    room.users--
                                    if (room.users == 0) {
                                        loaded_rooms.splice(index, 1)
                                    }
                                }
                            })
                            loaded_rooms.push({ id: rid, name: res.name, users: 1 });
                        }

                        socket.leave(socket.my_room)
                        socket.join(rid)

                        players.filter(player => {
                            if (player.socket == socket.id) {
                                player.room = rid
                                player.x = door_x
                                player.y = door_y
                                player.r = 0
                                player.state = "stand"
                                socket.emit("my_id", socket.id)
                            }
                        })

                        let player_in_prevroom = players.filter(player => { return player.room == socket.my_room });
                        io.in(socket.my_room).emit("player_update", player_in_prevroom)

                        socket.my_room = rid
                        let player_in_room = players.filter(player => { return player.room == rid });
                        io.in(rid).emit("player_update", player_in_room)
                    }
                }
            }

        })

        // LOAD FURNITURE IN ROOMS
        let furnis = []
        db.each("SELECT * FROM furniture WHERE room = ?", rid, (err, res) => {
            furnis.push(res);
        }, () => {
            //io.in(rid).emit("furni", furnis)
            io.emit("furni", furnis)
        })

    }

    socket.on("place_furni", data => {
        
        const rid = socket.my_room
        let mapx
        let furnis = []
        db.run("UPDATE furniture SET x = ?, y = ? WHERE id = ?", data.x, data.y, data.id, ()=>{
            db.each("SELECT * FROM rooms WHERE id = ?", rid, (err, res)=>{
                mapx = res.map
            }, ()=>{
                db.each("SELECT * FROM furniture WHERE room = ?", rid, (err1, res1) => {
                    furnis.push(res1)
                }, ()=>{
                    socket.emit("update_room", {map: mapx, furni: furnis})
                })
            })
        })
    })

    socket.on("move", data => {
        if (players) {
            const player = players.filter(player => { return player.socket == socket.id })
            if (typeof (player[0]) !== "undefined") {
                io.in(socket.my_room).emit("move", { id: player[0].id, x: data.x, y: data.y, state: "stand" })
            }
        }
    })

    socket.on("movement", data => {
        if (players) {
            players.filter(player => {
                if (data.id == player.id) {
                    if (player.socket == socket.id) {
                        player.x = data.x
                        player.y = data.y
                        player.r = data.r
                        player.state = "stand"
                    }
                }
            });
        }
    })

    socket.on("chat", data => {
        const player = players.filter(player => {
            if (player.socket == socket.id) {
                if (data.startsWith(":sit")) {
                    player.state = "sit"
                    io.to(player.room).emit("sit", { id: player.id })
                }
                else {
                    io.to(player.room).emit("chat", { username: player.username, message: data, x: player.x, y: player.y });
                }
            }
        })
    })

    socket.on('login', data => {
        db.each("SELECT COUNT(*) FROM users WHERE username = ? COLLATE NOCASE", data.username, (err, res) => {
            if (res["COUNT(*)"] == 0) {
                socket.emit("message", { type: "error_message", message: "Username not found" })
            }
            else {
                db.each("SELECT * FROM users WHERE username = ? COLLATE NOCASE", data.username, (err, res) => {
                    bcrypt.compare(data.password, res.password, (err, res1) => {
                        if (res1) {

                            players.filter(player => {
                                if (player.id == res.id) {
                                    io.to(player.socket).emit("make_disconnect");
                                }
                            })

                            socket.emit("message", { type: "success_login", message: "Logged in...", username: res.username, coins: res.coins })
                            players.push({ id: res.id, socket: socket.id, username: res.username, room: "1", x: 0, y: 0, r: 0, step: 0, state: "stand" })
                            let items = []
                            db.each("SELECT * FROM items", (item_err, item_res) => {
                                items.push(item_res)
                            }, () => {
                                socket.emit("items", items)
                                join_room("1");
                            })


                        }
                        else {
                            socket.emit("message", { type: "error_message", message: "Password incorrect" })
                        }
                    })
                })
            }
        })
    })
    socket.on('register', (data) => {
        const username_regex = /^[a-zA-Z0-9]+$/
        if (username_regex.test(data.username)) {
            db.each("SELECT COUNT(*) FROM users WHERE username = ? COLLATE NOCASE", data.username, (err, res) => {
                if (res["COUNT(*)"] == 0) {
                    db.each("SELECT COUNT(*) FROM users WHERE email = ? COLLATE NOCASE", data.email, (err, res) => {
                        if (res["COUNT(*)"] == 0) {
                            bcrypt.hash(data.password, saltRounds, (err, hash) => {
                                db.run("INSERT INTO users (username, email, password, coins) VALUES (?, ?, ?, 100)", data.username, data.email, hash, (err, res) => {
                                    socket.emit("message", { type: "succes_register", message: "Successfully registerd. Please login to continue." })
                                })
                            })
                        }
                        else {
                            socket.emit("message", { type: "error_message", message: "Email address already exist in server" })
                        }
                    })
                }
                else {
                    socket.emit("message", { type: "error_message", message: "Username already exist please use diffrent username" })
                }
            })
        }
    })

    socket.on('room_list', data => {
        if (data.room_type == "public") {
            let temp_room_list = []
            db.each("SELECT * FROM rooms WHERE owner = '0'", (err, res) => {
                let temp_room_count = 0
                let this_room_users = loaded_rooms.find(room => { return room.id == res.id });
                if (typeof (this_room_users) !== "undefined") {
                    temp_room_count = this_room_users.users;
                }
                temp_room_list.push({ id: res.id, name: res.name, users: temp_room_count })
            }, () => {
                socket.emit("room_list", temp_room_list);
            })
        }
        else if (data.room_type == "all") {
            socket.emit("room_list", loaded_rooms);
        }
        else if (data.room_type == "event") {
            socket.emit("room_list", [])
        }
        else if (data.room_type == "my") {
            let temp_room_list = []
            players.filter(player => {
                if (player.socket == socket.id) {
                    db.each("SELECT * FROM rooms WHERE owner = ?", player.id, (err, res) => {
                        let temp_room_count = 0
                        let this_room_users = loaded_rooms.find(room => { return room.id == res.id });
                        if (typeof (this_room_users) !== "undefined") {
                            temp_room_count = this_room_users.users;
                        }
                        temp_room_list.push({ id: res.id, name: res.name, users: temp_room_count })
                    }, () => {
                        socket.emit("room_list", temp_room_list);
                    })
                }
            });
        }
    })

    socket.on("goto", data => {
        join_room(data.room);
    })

    socket.on("typing", data => {
        players.forEach((player) => {
            if (player.socket == socket.id) {
                player.typing = data
                io.in(socket.my_room).emit("typing", { id: player.id, typing: player.typing })
            }
        })
    })

    socket.on('disconnect', () => {
        players.forEach((player, i) => {
            if (player.socket == socket.id) {
                loaded_rooms.filter((room, index) => {
                    if (room.id == player.room) {
                        room.users--
                        if (room.users == 0) {
                            loaded_rooms.splice(index, 1)
                        }
                    }
                })
                const room = player.room
                players.splice(i, 1)
                const player_in_room = players.filter(player => { return player.room == room });
                io.in(room).emit("player_update", player_in_room)
            }
        })

    })
})

http.listen(80, () => {
    console.log("Listening port: " + http.address().port)
})


/*##refrence for database
db.run(
        "CREATE TABLE Dreams (id INTEGER PRIMARY KEY AUTOINCREMENT, dream TEXT)"
    );
    console.log("New table Dreams created!")
    db.run("CREATE TABLE debug_log (id INTEGER PRIMARY KEY AUTOINCREMENT, dream TEXT)");
    // insert default dreams
    db.serialize(() => {
        db.run(
            'INSERT INTO Dreams (dream) VALUES ("Find and count some sheep"), ("Climb a really tall mountain"), ("Wash the dishes")'
        );
    });
} else {
    console.log('Database "Dreams" ready to go!');
    db.each("SELECT * from Dreams", (err, row) => {
        if (row) {
            console.log(`record: ${row.dream}`)
        }
    });
}
*/

/*socket io cheatsheet

io.on("connection", (socket) => {

  // sending to the client
  socket.emit("hello", "can you hear me?", 1, 2, "abc");

  // sending to all clients except sender
  socket.broadcast.emit("broadcast", "hello friends!");

  // sending to all clients in "game" room except sender
  socket.to("game").emit("nice game", "let's play a game");

  // sending to all clients in "game1" and/or in "game2" room, except sender
  socket.to("game1").to("game2").emit("nice game", "let's play a game (too)");

  // sending to all clients in "game" room, including sender
  io.in("game").emit("big-announcement", "the game will start soon");

  // sending to all clients in namespace "myNamespace", including sender
  io.of("myNamespace").emit("bigger-announcement", "the tournament will start soon");

  // sending to a specific room in a specific namespace, including sender
  io.of("myNamespace").to("room").emit("event", "message");

  // sending to individual socketid (private message)
  io.to(socketId).emit("hey", "I just met you");

  // WARNING: `socket.to(socket.id).emit()` will NOT work, as it will send to everyone in the room
  // named `socket.id` but the sender. Please use the classic `socket.emit()` instead.

  // sending with acknowledgement
  socket.emit("question", "do you think so?", (answer) => {});

  // sending without compression
  socket.compress(false).emit("uncompressed", "that's rough");

  // sending a message that might be dropped if the client is not ready to receive messages
  socket.volatile.emit("maybe", "do you really need it?");

  // sending to all clients on this node (when using multiple nodes)
  io.local.emit("hi", "my lovely babies");

  // sending to all connected clients
  io.emit("an event sent to all connected clients");

});

*/

/**
 * Reserved word for emit
 *
 * connect
 * connect_error
 * disconnect
 * disconnecting
 * newListener
 * removeListener
 */