import sqlite3

connection = sqlite3.connect('my_database.db')
cursor = connection.cursor()



def create_db() -> None:
    with sqlite3.connect("db"):
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS colors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE
        );

        
        CREATE TABLE IF NOT EXISTS bike_statuses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            status_name TEXT NOT NULL UNIQUE
        );

        
        CREATE TABLE IF NOT EXISTS parkings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            capacity INTEGER NOT NULL CHECK (capacity > 0),
            description TEXT
        );

        
        CREATE TABLE IF NOT EXISTS parking_spots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            spot_number INTEGER NOT NULL,
            is_occupied INTEGER NOT NULL DEFAULT 0 CHECK (is_occupied IN (0, 1)), -- 0 - свободно, 1 - занято
            parking_id INTEGER NOT NULL,
            FOREIGN KEY (parking_id) REFERENCES parkings(id) ON DELETE CASCADE,
            UNIQUE (parking_id, spot_number) -- Защита от дубликатов мест на одной парковке
        );

        
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            login TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user' -- Например: 'admin', 'user', 'owner'
        );

        -- 6. Сессионные токены пользователей
        CREATE TABLE IF NOT EXISTS tokens (
            user_id INTEGER PRIMARY KEY, -- ID пользователя как PK, так как связь 1-к-1 (или замените на AUTOINCREMENT, если нужно много токенов)
            access_token TEXT NOT NULL,
            refresh_token TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        
        CREATE TABLE IF NOT EXISTS bikes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            model VARCHAR(100) NOT NULL,
            special_features VARCHAR(100),
            photo_filename TEXT,
            color_id INTEGER,
            status_id INTEGER,
            owner_id INTEGER NOT NULL,
            parking_spot_id INTEGER,
            FOREIGN KEY (color_id) REFERENCES colors(id) ON DELETE SET NULL,
            FOREIGN KEY (status_id) REFERENCES bike_statuses(id) ON DELETE SET NULL,
            FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (parking_spot_id) REFERENCES parking_spots(id) ON DELETE SET NULL
        );
        ''')
        connection.commit()


create_db()