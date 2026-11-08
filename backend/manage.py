import argparse,getpass
from backend.main import db,init_db,uid,username,password_hash
parser=argparse.ArgumentParser()
parser.add_argument('command',choices=['create-admin','seed-parkings'])
parser.add_argument('--username')
parser.add_argument('--name',default='Администратор')
args=parser.parse_args();init_db()
if args.command=='create-admin':
    if not args.username:parser.error('--username required')
    password=getpass.getpass('Пароль администратора (от 12 символов): ')
    if len(password)<12:parser.error('Password too short')
    if getpass.getpass('Повторите пароль: ')!=password:parser.error('Passwords differ')
    with db(True) as c:c.execute('INSERT INTO users(id,username,name,phone,password,role,room) VALUES(?,?,?,?,?,?,?)',(uid(),username(args.username),args.name,'',password_hash(password),'admin',''))
    print('Администратор создан')
else:
    points=[(60,9,'8-1'),(30,26,'8-1'),(45,26,'8-1'),(30,44,'8-1'),(30,72,'8-1'),(76,22,'9-4'),(76,40,'9-4'),(76,57,'9-4'),(65,75,'9-4'),(47,90,'9-4')]
    with db(True) as c:
        if c.execute('SELECT 1 FROM parkings LIMIT 1').fetchone():raise SystemExit('Парковки уже существуют')
        for n,(x,y,building) in enumerate(points,1):
            id=uid();c.execute('INSERT INTO parkings(id,name,description,x,y) VALUES(?,?,?,?,?)',(id,f'Парковка {n} · {building}','Схема команды; вместимость требует сверки на месте',x,y))
            for spot in range(1,11 if building=='8-1' else 13):c.execute('INSERT INTO spots(id,parking_id,code) VALUES(?,?,?)',(uid(),id,f'П{n}-{spot:02}'))
    print('Схема импортирована. Закрепления не выдуманы. Вместимость сверьте с кампусом.')
