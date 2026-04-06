/**
 * A simple person struct with greeting functionality.
 */
typedef struct {
    char *name;
    int age;
} Person;

/**
 * Create a person with the given name and age.
 */
Person create_person(const char *name, int age) {
    Person p;
    p.name = (char *)name;
    p.age = age;
    return p;
}

int add(int x, int y) {
    return x + y;
}

int main(void) {
    Person p = create_person("Alice", 30);
    return add(1, 2);
}
