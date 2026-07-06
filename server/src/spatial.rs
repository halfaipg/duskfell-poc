use std::collections::HashMap;
use std::hash::Hash;

#[derive(Debug, Clone)]
pub struct SpatialIndex<K>
where
    K: Copy + Eq + Hash,
{
    cell_size: f32,
    cells: HashMap<Cell, Vec<K>>,
    positions: HashMap<K, Point>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Point {
    pub x: f32,
    pub y: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct Cell {
    x: i32,
    y: i32,
}

impl<K> SpatialIndex<K>
where
    K: Copy + Eq + Hash,
{
    pub fn new(cell_size: f32) -> Self {
        assert!(cell_size.is_finite() && cell_size > 0.0);
        Self {
            cell_size,
            cells: HashMap::new(),
            positions: HashMap::new(),
        }
    }

    pub fn insert_or_update(&mut self, key: K, point: Point) {
        let new_cell = self.cell_for(point);
        if let Some(old_point) = self.positions.insert(key, point) {
            let old_cell = self.cell_for(old_point);
            if old_cell != new_cell {
                self.remove_from_cell(key, old_cell);
            }
        }
        let cell_keys = self.cells.entry(new_cell).or_default();
        if !cell_keys.contains(&key) {
            cell_keys.push(key);
        }
    }

    pub fn remove(&mut self, key: K) {
        if let Some(point) = self.positions.remove(&key) {
            self.remove_from_cell(key, self.cell_for(point));
        }
    }

    pub fn query_radius(&self, center: Point, radius: f32) -> Vec<K> {
        if !radius.is_finite() || radius < 0.0 {
            return Vec::new();
        }

        let min_cell = self.cell_for(Point {
            x: center.x - radius,
            y: center.y - radius,
        });
        let max_cell = self.cell_for(Point {
            x: center.x + radius,
            y: center.y + radius,
        });
        let radius_sq = radius * radius;
        let mut found = Vec::new();

        for y in min_cell.y..=max_cell.y {
            for x in min_cell.x..=max_cell.x {
                if let Some(keys) = self.cells.get(&Cell { x, y }) {
                    for key in keys {
                        if let Some(point) = self.positions.get(key) {
                            let dx = point.x - center.x;
                            let dy = point.y - center.y;
                            if dx * dx + dy * dy <= radius_sq {
                                found.push(*key);
                            }
                        }
                    }
                }
            }
        }

        found
    }

    fn cell_for(&self, point: Point) -> Cell {
        Cell {
            x: (point.x / self.cell_size).floor() as i32,
            y: (point.y / self.cell_size).floor() as i32,
        }
    }

    fn remove_from_cell(&mut self, key: K, cell: Cell) {
        if let Some(keys) = self.cells.get_mut(&cell) {
            keys.retain(|candidate| candidate != &key);
            if keys.is_empty() {
                self.cells.remove(&cell);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_radius_finds_nearby_keys_only() {
        let mut index = SpatialIndex::new(100.0);
        index.insert_or_update(1, Point { x: 10.0, y: 10.0 });
        index.insert_or_update(2, Point { x: 80.0, y: 10.0 });
        index.insert_or_update(3, Point { x: 500.0, y: 500.0 });

        let mut found = index.query_radius(Point { x: 0.0, y: 0.0 }, 100.0);
        found.sort();

        assert_eq!(found, vec![1, 2]);
    }

    #[test]
    fn update_moves_keys_between_cells() {
        let mut index = SpatialIndex::new(50.0);
        index.insert_or_update("player", Point { x: 10.0, y: 10.0 });
        index.insert_or_update("player", Point { x: 200.0, y: 200.0 });

        assert!(index
            .query_radius(Point { x: 10.0, y: 10.0 }, 30.0)
            .is_empty());
        assert_eq!(
            index.query_radius(Point { x: 200.0, y: 200.0 }, 30.0),
            vec!["player"]
        );
    }

    #[test]
    fn remove_deletes_key_from_queries() {
        let mut index = SpatialIndex::new(50.0);
        index.insert_or_update(1, Point { x: 10.0, y: 10.0 });
        index.remove(1);

        assert!(index
            .query_radius(Point { x: 10.0, y: 10.0 }, 30.0)
            .is_empty());
    }
}
