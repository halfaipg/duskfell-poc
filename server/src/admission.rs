use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Arc;

use tokio::sync::Mutex;

use crate::AppState;

#[derive(Debug, Default)]
pub(crate) struct PeerConnectionCounts {
    active_by_ip: HashMap<IpAddr, usize>,
}

impl PeerConnectionCounts {
    fn try_acquire(&mut self, ip: IpAddr, limit: usize) -> bool {
        let active = self.active_by_ip.entry(ip).or_insert(0);
        if *active >= limit {
            return false;
        }

        *active += 1;
        true
    }

    fn release(&mut self, ip: IpAddr) {
        if let Some(active) = self.active_by_ip.get_mut(&ip) {
            *active = active.saturating_sub(1);
            if *active == 0 {
                self.active_by_ip.remove(&ip);
            }
        }
    }

    pub(crate) fn active_ips(&self) -> usize {
        self.active_by_ip.len()
    }
}

#[derive(Debug)]
pub(crate) struct PeerConnectionPermit {
    connections: Arc<Mutex<PeerConnectionCounts>>,
    peer_ip: IpAddr,
    released: bool,
}

impl PeerConnectionPermit {
    pub(crate) async fn try_acquire(state: &AppState, peer_ip: IpAddr) -> Option<Self> {
        if !state
            .peer_connections
            .lock()
            .await
            .try_acquire(peer_ip, state.max_connections_per_ip)
        {
            return None;
        }

        Some(Self {
            connections: state.peer_connections.clone(),
            peer_ip,
            released: false,
        })
    }

    pub(crate) async fn release(mut self) {
        self.release_inner().await;
    }

    async fn release_inner(&mut self) {
        if self.released {
            return;
        }

        self.connections.lock().await.release(self.peer_ip);
        self.released = true;
    }
}

impl Drop for PeerConnectionPermit {
    fn drop(&mut self) {
        if self.released {
            return;
        }

        let connections = self.connections.clone();
        let peer_ip = self.peer_ip;
        self.released = true;
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(async move {
                connections.lock().await.release(peer_ip);
            });
        }
    }
}

#[derive(Debug, Default)]
pub(crate) struct AccountConnectionCounts {
    active_by_subject: HashMap<String, usize>,
}

impl AccountConnectionCounts {
    fn try_acquire(&mut self, account_subject: &str, limit: usize) -> bool {
        let active = self
            .active_by_subject
            .entry(account_subject.to_string())
            .or_insert(0);
        if *active >= limit {
            return false;
        }

        *active += 1;
        true
    }

    fn release(&mut self, account_subject: &str) {
        if let Some(active) = self.active_by_subject.get_mut(account_subject) {
            *active = active.saturating_sub(1);
            if *active == 0 {
                self.active_by_subject.remove(account_subject);
            }
        }
    }

    pub(crate) fn active_accounts(&self) -> usize {
        self.active_by_subject.len()
    }
}

#[derive(Debug)]
pub(crate) struct AccountConnectionPermit {
    connections: Option<Arc<Mutex<AccountConnectionCounts>>>,
    account_subject: Option<String>,
    released: bool,
}

impl AccountConnectionPermit {
    pub(crate) async fn try_acquire(
        state: &AppState,
        account_subject: Option<&str>,
    ) -> Option<Self> {
        let Some(account_subject) = account_subject else {
            return Some(Self {
                connections: None,
                account_subject: None,
                released: true,
            });
        };

        if !state
            .account_connections
            .lock()
            .await
            .try_acquire(account_subject, state.max_connections_per_account)
        {
            return None;
        }

        Some(Self {
            connections: Some(state.account_connections.clone()),
            account_subject: Some(account_subject.to_string()),
            released: false,
        })
    }

    pub(crate) async fn release(mut self) {
        self.release_inner().await;
    }

    async fn release_inner(&mut self) {
        if self.released {
            return;
        }

        if let (Some(connections), Some(account_subject)) =
            (self.connections.as_ref(), self.account_subject.as_deref())
        {
            connections.lock().await.release(account_subject);
        }
        self.released = true;
    }
}

impl Drop for AccountConnectionPermit {
    fn drop(&mut self) {
        if self.released {
            return;
        }

        let connections = self.connections.clone();
        let account_subject = self.account_subject.clone();
        self.released = true;
        if let (Some(connections), Some(account_subject)) = (connections, account_subject) {
            if let Ok(handle) = tokio::runtime::Handle::try_current() {
                handle.spawn(async move {
                    connections.lock().await.release(&account_subject);
                });
            }
        }
    }
}
