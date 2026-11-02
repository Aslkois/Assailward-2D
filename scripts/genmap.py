W, H = 100, 70
g = [[','] * W for _ in range(H)]

def rect(x0, y0, x1, y1, ch):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            g[y][x] = ch

def hline(x0, x1, y, ch): rect(x0, y, x1, y, ch)
def vline(x, y0, y1, ch): rect(x, y0, x, y1, ch)
def door_h(x, y): hline(x, x + 2, y, 'D')
def door_v(x, y): vline(x, y, y + 2, 'D')

# map boundary
hline(0, W - 1, 0, '#'); hline(0, W - 1, H - 1, '#'); vline(0, 0, H - 1, '#'); vline(W - 1, 0, H - 1, '#')
# building floor + walls
rect(14, 12, 86, 58, '.')
hline(14, 86, 12, '#'); hline(14, 86, 58, '#'); vline(14, 12, 58, '#'); vline(86, 12, 58, '#')
vline(35, 12, 58, '#'); vline(63, 12, 58, '#'); hline(14, 86, 27, '#'); hline(14, 86, 42, '#')

# soft (destructible, reinforceable) wall sections
hline(70, 77, 12, '=')      # offices north exterior
vline(14, 31, 38, '=')      # storage west exterior
vline(86, 31, 38, '=')      # break room east exterior
hline(44, 55, 58, '=')      # archive south exterior
vline(35, 20, 25, '=')      # lobby | main hall
hline(16, 22, 27, '=')      # lobby | storage
vline(35, 30, 33, '='); vline(35, 36, 39, '=')   # storage | server
hline(52, 58, 27, '=')      # main hall | server
vline(63, 14, 18, '=')      # main hall | offices
vline(63, 29, 31, '='); vline(63, 37, 40, '=')   # server | break
hline(66, 72, 27, '=')      # offices | break
hline(25, 32, 42, '=')      # storage | garage
hline(76, 83, 42, '=')      # break | workshop
vline(35, 44, 47, '=')      # garage | archive
vline(63, 51, 55, '=')      # archive | workshop
# pre-reinforced wall (hard breach only)
hline(44, 62, 42, '%')      # server | archive

# exterior doorways
door_h(22, 12); door_v(14, 18); door_h(48, 12); door_v(86, 18)
door_v(14, 48); door_h(24, 58); door_h(74, 58); door_v(86, 50)
# interior doorways
door_v(35, 16); door_v(63, 21); door_h(25, 27); door_h(44, 27); door_h(75, 27)
door_h(20, 42); door_v(63, 33); door_h(70, 42); door_v(35, 50); door_v(63, 46); door_h(40, 42)

# objective zone
rect(44, 33, 54, 36, 'o')

# props (indestructible cover)
props = [
    (27, 21, 31, 22), (17, 15, 20, 15),                                   # lobby
    (41, 17, 42, 18), (56, 17, 57, 18), (41, 22, 42, 23), (56, 22, 57, 23),  # main hall pillars
    (67, 15, 69, 16), (73, 15, 75, 16), (79, 15, 81, 16), (67, 22, 69, 23), (80, 22, 82, 23),  # offices
    (18, 31, 19, 32), (27, 34, 29, 35), (17, 38, 18, 39),                  # storage
    (40, 31, 46, 31), (52, 31, 58, 31), (40, 38, 46, 38), (52, 38, 58, 38),  # server racks
    (69, 31, 71, 32), (78, 35, 80, 36),                                    # break room
    (19, 46, 24, 48), (28, 53, 32, 55),                                    # garage vehicles
    (38, 47, 44, 47), (38, 51, 44, 51), (38, 55, 44, 55),                  # archive shelves
    (49, 46, 56, 46), (49, 50, 56, 50), (49, 54, 56, 54),
    (78, 46, 82, 47), (67, 50, 71, 51), (69, 54, 72, 55),                  # workshop benches
    (28, 5, 32, 6), (62, 6, 66, 7),                                        # north yard
    (6, 24, 8, 27), (5, 52, 7, 54),                                        # west yard
    (40, 63, 44, 64), (64, 62, 67, 63),                                    # south yard
    (92, 30, 94, 33), (91, 44, 93, 46),                                    # east yard
    (36, 2, 38, 3), (61, 2, 63, 3),                                        # north spawn cover
    (44, 6, 54, 6),                                                        # north spawn sightline block
    (87, 60, 90, 60),                                                      # southeast dock cover
]
for p in props:
    rect(p[0], p[1], p[2], p[3], '+')

rows = [''.join(r) for r in g]
print('\n'.join(rows))
