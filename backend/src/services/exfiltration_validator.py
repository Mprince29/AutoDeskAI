import re
from typing import List

class TrieNode:
    def __init__(self):
        self.children = {}
        self.is_end_of_word = False

class ExfiltrationValidator:
    """
    O(L) Trie-based validator for outbound data (emails, domains).
    Ensures background agents cannot exfiltrate data to unauthorized domains.
    """
    def __init__(self, allowed_domains: List[str]):
        self.root = TrieNode()
        for domain in allowed_domains:
            self._insert(domain.lower())

    def _insert(self, domain: str):
        node = self.root
        # Standard insert into Trie
        for char in domain:
            if char not in node.children:
                node.children[char] = TrieNode()
            node = node.children[char]
        node.is_end_of_word = True

    def is_domain_allowed(self, domain: str) -> bool:
        """
        Check if the exact domain is allowed.
        """
        node = self.root
        for char in domain.lower():
            if char not in node.children:
                return False
            node = node.children[char]
        return node.is_end_of_word

    def extract_domain_from_email(self, email: str) -> str:
        """
        Extracts the domain part from an email address using Regex.
        """
        match = re.search(r"@([\w.-]+)", email)
        if match:
            return match.group(1).lower()
        return ""

    def validate_outbound_emails(self, emails: List[str], allow_all=False) -> bool:
        """
        Validates a list of email addresses. 
        If allow_all is True, this is bypassed (for specific highly trusted agents).
        Returns True if all emails belong to allowed domains.
        """
        if allow_all:
            return True
            
        if not self.root.children:  # Empty trie = block everything if allow_all is False
            return False

        for email in emails:
            domain = self.extract_domain_from_email(email)
            if not domain or not self.is_domain_allowed(domain):
                return False
        return True

# Initialize a global validator instance
# By default, we might allow certain safe domains or require manual user whitelisting.
# For AutoDeskAI, we initialize with core internal domains or leave it strict.
GLOBAL_EXFILTRATION_VALIDATOR = ExfiltrationValidator([
    "gmail.com",
    "example.com",
    "expert.com",
    "google.com"
])
